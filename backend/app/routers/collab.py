"""Communication (messagerie entre utilisateurs du serveur), export Excel, note de recherche rédigée par IA."""
import io
import json
import re
import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill
from pydantic import BaseModel, Field

from .. import config, db
from ..cache import SourceError, cached

router = APIRouter(prefix="/api", tags=["communication et outils"])

SCHEMA = """
CREATE TABLE IF NOT EXISTS chat_users (id INTEGER PRIMARY KEY, handle TEXT UNIQUE NOT NULL, token TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'disponible', last_seen TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS chat_rooms (id INTEGER PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS chat_members (room_id INTEGER NOT NULL, user_id INTEGER NOT NULL, last_read INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (room_id, user_id));
CREATE TABLE IF NOT EXISTS chat_messages (id INTEGER PRIMARY KEY, room_id INTEGER NOT NULL, user_id INTEGER NOT NULL, body TEXT NOT NULL, attachment TEXT, sent_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS chat_messages_room ON chat_messages(room_id, id);
"""
HANDLE = re.compile(r"^[A-Za-z0-9_.-]{3,24}$")


def init():
    with db.conn() as c:
        c.executescript(SCHEMA)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _user(token: str | None) -> dict:
    if not token:
        raise HTTPException(401, "Identifiant de messagerie manquant")
    with db.conn() as c:
        u = c.execute("SELECT id, handle, status FROM chat_users WHERE token=?", (token,)).fetchone()
        if not u:
            raise HTTPException(401, "Identifiant de messagerie inconnu : choisir à nouveau un pseudo")
        c.execute("UPDATE chat_users SET last_seen=? WHERE id=?", (_now(), u["id"]))
    return dict(u)


class Register(BaseModel):
    handle: str


@router.post("/chat/register")
def register(body: Register):
    if not HANDLE.match(body.handle):
        raise HTTPException(400, "Pseudo : 3 à 24 caractères (lettres, chiffres, . _ -)")
    token = secrets.token_urlsafe(24)
    with db.conn() as c:
        if c.execute("SELECT 1 FROM chat_users WHERE lower(handle)=lower(?)", (body.handle,)).fetchone():
            raise HTTPException(409, "Ce pseudo est déjà pris sur ce serveur")
        cur = c.execute("INSERT INTO chat_users(handle, token, last_seen) VALUES (?,?,?)", (body.handle, token, _now()))
    return {"id": cur.lastrowid, "handle": body.handle, "token": token}


class Status(BaseModel):
    status: str = Field(max_length=40)


@router.post("/chat/status")
def set_status(body: Status, x_chat_token: str | None = Header(None)):
    u = _user(x_chat_token)
    with db.conn() as c:
        c.execute("UPDATE chat_users SET status=? WHERE id=?", (body.status, u["id"]))
    return {"ok": True}


@router.get("/chat/me")
def me(x_chat_token: str | None = Header(None)):
    return _user(x_chat_token)


@router.get("/chat/users")
def users(x_chat_token: str | None = Header(None)):
    _user(x_chat_token)
    with db.conn() as c:
        rows = [dict(r) for r in c.execute("SELECT id, handle, status, last_seen FROM chat_users ORDER BY handle")]
    now = datetime.now(timezone.utc)
    for r in rows:
        r["online"] = (now - datetime.fromisoformat(r["last_seen"])).total_seconds() < 90
    return rows


class Room(BaseModel):
    name: str = Field("", max_length=60)
    members: list[int] = Field(min_length=1, max_length=50)


@router.post("/chat/rooms")
def create_room(body: Room, x_chat_token: str | None = Header(None)):
    u = _user(x_chat_token)
    members = sorted(set(body.members) | {u["id"]})
    kind = "direct" if len(members) == 2 and not body.name else "group"
    with db.conn() as c:
        if kind == "direct":  # une seule conversation par paire
            ex = c.execute("""SELECT r.id FROM chat_rooms r WHERE r.kind='direct' AND
                              (SELECT group_concat(user_id) FROM (SELECT user_id FROM chat_members WHERE room_id=r.id ORDER BY user_id)) = ?""",
                           (",".join(map(str, members)),)).fetchone()
            if ex:
                return {"id": ex["id"]}
        cur = c.execute("INSERT INTO chat_rooms(name, kind, created_at) VALUES (?,?,?)", (body.name, kind, _now()))
        c.executemany("INSERT INTO chat_members(room_id, user_id) VALUES (?,?)", [(cur.lastrowid, m) for m in members])
    return {"id": cur.lastrowid}


@router.get("/chat/rooms")
def rooms(x_chat_token: str | None = Header(None)):
    u = _user(x_chat_token)
    with db.conn() as c:
        rs = [dict(r) for r in c.execute("""SELECT r.id, r.name, r.kind, m.last_read,
              (SELECT group_concat(handle, ', ') FROM chat_users cu JOIN chat_members cm ON cm.user_id=cu.id WHERE cm.room_id=r.id AND cu.id<>?) AS others,
              (SELECT max(id) FROM chat_messages WHERE room_id=r.id) AS last_id,
              (SELECT count(*) FROM chat_messages WHERE room_id=r.id AND id>m.last_read AND user_id<>?) AS unread
              FROM chat_rooms r JOIN chat_members m ON m.room_id=r.id WHERE m.user_id=? ORDER BY last_id DESC NULLS LAST, r.id DESC""", (u["id"], u["id"], u["id"]))]
    return rs


def _member(c, room: int, uid: int):
    if not c.execute("SELECT 1 FROM chat_members WHERE room_id=? AND user_id=?", (room, uid)).fetchone():
        raise HTTPException(403, "Vous ne participez pas à cette conversation")


@router.get("/chat/rooms/{room}/messages")
def messages(room: int, after: int = 0, x_chat_token: str | None = Header(None)):
    u = _user(x_chat_token)
    with db.conn() as c:
        _member(c, room, u["id"])
        rows = [dict(r) for r in c.execute("""SELECT m.id, m.body, m.attachment, m.sent_at, u.handle FROM chat_messages m JOIN chat_users u ON u.id=m.user_id
                                              WHERE room_id=? AND m.id>? ORDER BY m.id LIMIT 500""", (room, after))]
        if rows:
            c.execute("UPDATE chat_members SET last_read=? WHERE room_id=? AND user_id=?", (rows[-1]["id"], room, u["id"]))
    for r in rows:
        r["attachment"] = json.loads(r["attachment"]) if r["attachment"] else None
    return rows


class Message(BaseModel):
    body: str = Field("", max_length=4000)
    attachment: dict | None = None  # {kind: "instrument" | "quote", symbol, price?, change_pct?, source?, time?}


@router.post("/chat/rooms/{room}/messages")
def post(room: int, body: Message, x_chat_token: str | None = Header(None)):
    u = _user(x_chat_token)
    if not body.body.strip() and not body.attachment:
        raise HTTPException(400, "Message vide")
    with db.conn() as c:
        _member(c, room, u["id"])
        cur = c.execute("INSERT INTO chat_messages(room_id, user_id, body, attachment, sent_at) VALUES (?,?,?,?,?)",
                        (room, u["id"], body.body.strip(), json.dumps(body.attachment) if body.attachment else None, _now()))
    return {"id": cur.lastrowid}


# ─────────────────────────── Export Excel ───────────────────────────
class Sheet(BaseModel):
    name: str = Field(max_length=31)
    columns: list[str]
    rows: list[list]


class Export(BaseModel):
    filename: str = Field(max_length=80)
    sheets: list[Sheet] = Field(min_length=1, max_length=20)
    source: str = ""


@router.post("/export/xlsx")
def export_xlsx(body: Export):
    wb = Workbook()
    wb.remove(wb.active)
    for s in body.sheets:
        ws = wb.create_sheet(re.sub(r"[\\/*?:\[\]]", " ", s.name)[:31] or "Feuille")
        ws.append(s.columns)
        for cell in ws[1]:
            cell.font, cell.fill = Font(bold=True, color="000000"), PatternFill("solid", fgColor="FFA028")
        for r in s.rows:
            ws.append([v if isinstance(v, (int, float, str)) or v is None else str(v) for v in r])
        if body.source:
            ws.append([])
            ws.append([f"Source : {body.source} · exporté le {_now()}"])
        for col in ws.columns:
            ws.column_dimensions[col[0].column_letter].width = min(40, max(10, *(len(str(c.value or "")) for c in col[:200])) + 2)
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    name = re.sub(r"[^A-Za-z0-9_.-]", "_", body.filename) or "export"
    return StreamingResponse(buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={"Content-Disposition": f'attachment; filename="{name}.xlsx"'})


# ─────────────────────────── Recherche : note rédigée par IA ───────────────────────────
@router.get("/research/brief")
def brief(symbol: str, force: bool = False):
    """Note de synthèse sur un actif, rédigée par Gemini à partir des seules données du terminal (cours, statistiques, états financiers, news)."""
    from .. import gemini
    from . import analysis, overview, news

    def fetch():
        if not config.GEMINI_API_KEY:
            raise SourceError("Clé Gemini absente : renseigner GEMINI_API_KEY dans .env pour activer les notes de recherche.")
        ctx: dict = {"symbole": symbol}
        try:
            d = overview.describe(symbol)["data"]
            ctx["cotation"] = {k: d.get(k) for k in ("name", "type", "exchange", "currency", "last", "d1", "w1", "m1", "ytd", "hi52", "lo52", "vol20")}
        except Exception as e:
            ctx["cotation"] = f"indisponible ({e})"
        try:
            f = analysis.fa(symbol)["data"]
            ctx["fondamentaux"] = {"ratios": f["ratios"], "valorisation": f["valuation"], "ttm": f["ttm"]}
        except Exception:
            ctx["fondamentaux"] = "non applicable ou indisponible"
        try:
            ctx["news"] = [n["title"] for n in news.news(symbol=symbol, limit=15)["data"]["items"]]
        except Exception:
            ctx["news"] = []
        resp, model = gemini.generate(
            "Données (JSON) :\n" + json.dumps(ctx, ensure_ascii=False, default=str),
            system_instruction=(
                "Tu es analyste sell-side. Rédige en français une note de recherche concise et factuelle sur l'actif, en Markdown, "
                "avec les sections : Synthèse, Dynamique de marché, Fondamentaux (si disponibles), Actualité, Risques, Points à surveiller. "
                "N'utilise QUE les données fournies ; cite les chiffres ; n'invente aucun objectif de cours ni consensus ; "
                "si une donnée manque, dis-le. Pas de recommandation d'achat ou de vente."))
        return {"symbol": symbol, "markdown": resp.text, "model": model, "inputs": list(ctx)}
    return cached(f"brief:{symbol.upper()}", 6 * 3600, "Google Gemini (texte généré)", fetch, force=force)
