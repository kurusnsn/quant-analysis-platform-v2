import os
import pytest
import requests
import time
import sys
import json

if os.getenv("RUN_API_RUNNER_TESTS") != "1":
    pytest.skip("Skipping API runner integration test (set RUN_API_RUNNER_TESTS=1 to enable).", allow_module_level=True)

def test_api():
    base_url = "http://127.0.0.1:8003"
    
    # Wait for server
    print("Waiting for server...")
    for _ in range(30): # Wait longer for model download
        try:
            requests.get(f"{base_url}/health")
            break
        except:
            time.sleep(1)
    else:
        print("Server failed to start")
        sys.exit(1)

    print("Server is up. Running tests...")

    # Test 1: Brief Query
    print("\n--- Test 1: Brief Query ---")
    resp = requests.post(f"{base_url}/insights", params={"query": "What is the market sentiment?", "user_id": "u1"})
    if resp.status_code != 200:
        print(f"Failed: {resp.text}")
        return
        
    data = resp.json()
    print(f"Level: {data['level']}")
    print(f"Summary: {data['summary'][:200]}...") # Print first 200 chars
    assert data["level"] == "brief"

    # Test 2: Deep Query
    print("\n--- Test 2: Deep Query ---")
    resp = requests.post(f"{base_url}/insights", params={"query": "Why should I compare AAPL vs MSFT risks?", "user_id": "u1"})
    data = resp.json()
    print(f"Level: {data['level']}")
    print(f"Summary: {data['summary'][:200]}...")
    assert data["level"] == "deep"

if __name__ == "__main__":
    test_api()
