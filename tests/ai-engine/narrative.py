class NarrativeGenerator:
    """
    LLM narrative fallback chain and prompt construction logic.
    Proprietary generator implementations omitted in public snapshot.
    """
    def __init__(self):
        self.llm_enabled = False

    def explain(self, risk_data):
        return "Deterministic narrative generated from risk metrics. LLM explanation omitted."

narrative_generator = NarrativeGenerator()
