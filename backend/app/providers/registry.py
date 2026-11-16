"""Point unique de branchement des fournisseurs."""
from .bis import BIS
from .ecb import ECB
from .fred import Fred
from .treasury import Treasury
from .yahoo import Yahoo

prices = Yahoo()
treasury = Treasury()
policy = BIS()
macro = Fred()
fx = ECB()
