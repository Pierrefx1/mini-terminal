import assert from "node:assert/strict";
import { test } from "node:test";
import * as C from "../lib/choropleth.ts";

test("quantiles : paliers croissants, extrêmes inclus, doublons fusionnés", () => {
  const xs = Array.from({ length: 100 }, (_, i) => i ** 2);
  const b = C.quantileBreaks(xs, 7);
  assert.equal(b[0], 0); assert.equal(b.at(-1), 99 ** 2);
  assert.ok(b.every((x, i) => i === 0 || x > b[i - 1]));
  assert.deepEqual(C.quantileBreaks([5, 5, 5], 7), [5]);
});

test("échelle séquentielle : chaque valeur a une couleur, le maximum aussi", () => {
  const xs = [1, 2, 3, 10, 50, 200, 5000, 1e6];
  const { pieces, diverging } = C.pieces(xs);
  assert.equal(diverging, false);
  for (const x of xs) assert.ok(C.colorOf(pieces, x), `couleur pour ${x}`);
  assert.notEqual(C.colorOf(pieces, 1), C.colorOf(pieces, 1e6));
});

test("échelle divergente autour de zéro pour des valeurs de signes mixtes", () => {
  const xs = [-8, -5, -3, -1, -0.5, 0, 0.5, 1, 2, 3, 4, 6, 9];
  const { pieces, diverging } = C.pieces(xs);
  assert.equal(diverging, true);
  const neg = C.colorOf(pieces, -3), pos = C.colorOf(pieces, 3);
  assert.ok(neg && pos && neg !== pos);
  assert.ok(pieces.some((p) => p.max === 0) && pieces.some((p) => p.min === 0), "zéro est une frontière");
  for (const x of xs) assert.ok(C.colorOf(pieces, x), `couleur pour ${x}`);
  // un seul pays négatif sur cent : pas de divergence
  assert.equal(C.pieces([-1, ...Array.from({ length: 99 }, (_, i) => i + 1)]).diverging, false);
});
