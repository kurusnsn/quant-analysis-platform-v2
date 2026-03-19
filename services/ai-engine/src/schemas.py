from enum import Enum
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field, field_validator

class InsightLevel(str, Enum):
    BRIEF = "brief"
    STANDARD = "standard"
    DEEP = "deep"

class Insight(BaseModel):
    label: str
    value: str

class Calculation(BaseModel):
    name: str
    value: float
    formula: str
    inputs: Dict[str, Any]

class Citation(BaseModel):
    source: str
    title: str
    url: Optional[str] = None
    chunk: str

class Metadata(BaseModel):
    model: str
    latency_ms: int
    cached: bool = False

class AIResponse(BaseModel):
    level: InsightLevel
    summary: str
    insights: List[Insight] = []
    reasoning: Optional[str] = None
    calculations: List[Calculation] = []
    citations: List[Citation] = []
    metadata: Metadata

    @field_validator('reasoning')
    def validate_reasoning(cls, v, info):
        # We need access to 'level' to validate this, but pydantic V2 validation 
        # is slightly different. Let's use a root validator or model_validator in V2.
        # Keeping it simple for V1/V2 compat: deep must have reasoning.
        return v
    
    @field_validator('level')
    def validate_level_constraints(cls, v, info):
        # We check full object validity in a model_validator usually.
        return v

    def model_post_init(self, __context):
        if self.level == InsightLevel.DEEP and not self.reasoning:
             raise ValueError("Deep insights must include reasoning.")
