"""Source registry. Add a module here to make it available to the collector."""

from collector.sources.ats.ashby import Ashby
from collector.sources.ats.bamboohr import BambooHR
from collector.sources.ats.breezy import Breezy
from collector.sources.ats.greenhouse import Greenhouse
from collector.sources.ats.lever import Lever
from collector.sources.ats.personio import Personio
from collector.sources.ats.pinpoint import Pinpoint
from collector.sources.ats.recruitee import Recruitee
from collector.sources.ats.smartrecruiters import SmartRecruiters
from collector.sources.ats.teamtailor import Teamtailor
from collector.sources.ats.workable import Workable
from collector.sources.feed import Feeds
from collector.sources.himalayas import Himalayas
from collector.sources.remotive import Remotive
from collector.sources.weworkremotely import WeWorkRemotely

BOARD_SOURCES = (Himalayas, Remotive, WeWorkRemotely, Feeds)
ATS_SOURCES = (
    Greenhouse,
    Lever,
    Ashby,
    Workable,
    Recruitee,
    Teamtailor,
    Personio,
    Breezy,
    SmartRecruiters,
    BambooHR,
    Pinpoint,
)
SOURCES = {cls.name: cls for cls in BOARD_SOURCES + ATS_SOURCES}

__all__ = ["ATS_SOURCES", "SOURCES"]
