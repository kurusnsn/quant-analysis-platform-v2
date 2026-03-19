from .schemas import InsightLevel

def route_query(query: str) -> tuple[InsightLevel, str]:
    """
    Determines the insight level and model based on the query.
    Returns: (InsightLevel, model_name)
    """
    query_lower = query.lower()
    
    # Heuristic for Deep
    if any(keyword in query_lower for keyword in ["why", "compare", "risk", "variance", "predict", "calculate"]):
        return InsightLevel.DEEP, "deepseek-r1-distill"
        
    # Default to Brief
    return InsightLevel.BRIEF, "llama-3.1"
