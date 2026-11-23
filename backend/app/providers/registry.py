"""Point unique de branchement des fournisseurs."""
from .bis import BIS
from .cftc import CFTC
from .eia import EIA
from .ecb import ECB
from .fred import Fred
from .treasury import Treasury
from .yahoo import Yahoo
from .yahoo_options import YahooOptions

prices = Yahoo()
treasury = Treasury()
policy = BIS()
macro = Fred()
fx = ECB()
# Options (OMON) : Yahoo via yfinance, grecques calculées par le terminal (CBOE refuse désormais les appels automatisés)
options = YahooOptions()
inventories = EIA()
cot = CFTC()
