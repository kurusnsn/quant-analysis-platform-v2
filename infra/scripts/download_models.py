"""
Script to download FinBERT models and cache them for offline/docker use.
Usage: python download_models.py
"""
import os
from transformers import AutoTokenizer, AutoModelForSequenceClassification
import torch

MODEL_NAME = "ProsusAI/finbert"
CACHE_DIR = os.getenv("MODEL_CACHE_DIR", "./data/model_cache")

def download_finbert():
    print(f"Downloading {MODEL_NAME} to {CACHE_DIR}...")
    
    # Create directory if not exists
    os.makedirs(CACHE_DIR, exist_ok=True)
    
    # Download Tokenizer
    tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME, cache_dir=CACHE_DIR)
    tokenizer.save_pretrained(os.path.join(CACHE_DIR, "tokenizer"))
    print("Tokenizer saved.")
    
    # Download Model
    model = AutoModelForSequenceClassification.from_pretrained(MODEL_NAME, cache_dir=CACHE_DIR)
    model.save_pretrained(os.path.join(CACHE_DIR, "model"))
    print("Model saved.")
    
    print("✅ Model download complete.")

if __name__ == "__main__":
    download_finbert()
