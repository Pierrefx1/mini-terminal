"""Point unique de branchement des fournisseurs."""
from .bis import BIS
from .cboe import Cboe
from .cftc import CFTC
from .eia import EIA
from .ecb import ECB
from .fred import Fred
from .treasury import Treasury
from .yahoo import Yahoo

prices = Yahoo()
treasury = Treasury()
policy = BIS()
macro = Fred()
fx = ECB()
options = Cboe()
inventories = EIA()
cot = CFTC()
