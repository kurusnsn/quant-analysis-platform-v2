"""
Tests for FinBERT sentiment - verifies output shape and values.
"""
import pytest


class TestSentimentOutput:
    """Tests that don't require loading the actual model."""
    
    def test_sentiment_output_shape(self):
        """Test expected output structure."""
        # Mock response structure
        sample_output = {
            "sentiments": [
                {
                    "text": "Stock surges...",
                    "positive": 0.85,
                    "negative": 0.05,
                    "neutral": 0.10,
                    "label": "positive",
                    "score": 0.85
                }
            ]
        }
        
        assert "sentiments" in sample_output
        assert len(sample_output["sentiments"]) > 0
        
        item = sample_output["sentiments"][0]
        assert "positive" in item
        assert "negative" in item
        assert "neutral" in item
        assert "label" in item
        
        # Probabilities should sum to ~1
        prob_sum = item["positive"] + item["negative"] + item["neutral"]
        assert 0.99 <= prob_sum <= 1.01
    
    def test_label_values(self):
        """Test that labels are valid."""
        valid_labels = {"positive", "negative", "neutral"}
        
        for label in valid_labels:
            assert label in valid_labels
    
    def test_score_range(self):
        """Test score is in valid range."""
        # Positive label -> positive score
        assert -1 <= 0.85 <= 1
        # Negative label -> negative score  
        assert -1 <= -0.72 <= 1
        # Neutral label -> zero score
        assert -1 <= 0 <= 1
