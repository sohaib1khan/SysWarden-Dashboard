from __future__ import annotations

import re
from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

_METRIC_NAME_RE = re.compile(r"^[a-z][a-z0-9_.]{0,63}$")
_AGENT_ID_RE = re.compile(r"^[0-9a-f]{32}$")


class MetricPoint(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(..., min_length=1, max_length=64)
    value: float
    unit: Optional[str] = Field(None, max_length=32)
    timestamp: Optional[datetime] = None  # backend sets if omitted

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        if not _METRIC_NAME_RE.match(v):
            raise ValueError(
                "Metric name must be lowercase, start with a letter, "
                "and contain only letters, digits, underscores, or dots"
            )
        return v

    @field_validator("value")
    @classmethod
    def validate_value(cls, v: float) -> float:
        import math
        if math.isnan(v) or math.isinf(v):
            raise ValueError("Metric value must be a finite number")
        return v


class MetricIngestRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    agent_id: str = Field(..., min_length=32, max_length=32)
    metrics: List[MetricPoint] = Field(..., min_length=1, max_length=100)

    @field_validator("agent_id")
    @classmethod
    def validate_agent_id(cls, v: str) -> str:
        if not _AGENT_ID_RE.match(v):
            raise ValueError("Invalid agent_id format")
        return v


class MetricResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    agent_id: str
    name: str
    value: float
    unit: Optional[str]
    timestamp: datetime
