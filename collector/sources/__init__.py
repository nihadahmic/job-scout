"""Source registry. Add a module here to make it available to the collector."""

from collector.sources.himalayas import Himalayas
from collector.sources.remotive import Remotive
from collector.sources.weworkremotely import WeWorkRemotely

SOURCES = {cls.name: cls for cls in (Himalayas, Remotive, WeWorkRemotely)}

__all__ = ["SOURCES"]
