"""Point unique de branchement des fournisseurs."""
from .. import config
from .bis import BIS
from .cboe import Cboe
from .tradier import Tradier
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
# Options : Tradier dès qu'une clé est configurée ; sinon CBOE (qui refuse désormais les appels automatisés)
options = Tradier() if config.TRADIER_API_KEY else Cboe()
inventories = EIA()
cot = CFTC()
