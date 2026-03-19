import os
import pytest
import requests
import time
import sys

if os.getenv("RUN_API_RUNNER_TESTS") != "1":
    pytest.skip("Skipping API runner integration test (set RUN_API_RUNNER_TESTS=1 to enable).", allow_module_level=True)

def test_api():
    base_url = "http://127.0.0.1:8000"
    
    # Wait for server
    for _ in range(10):
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
    resp = requests.post(f"{base_url}/insights", params={"query": "Market overview", "user_id": "u1"})
    data = resp.json()
    assert data["level"] == "brief", f"Expected brief, got {data['level']}"
    assert "llama" in data["metadata"]["model"], "Expected Llama model"
    print("✅ Brief Query Test Passed")

    # Test 2: Deep Query
    resp = requests.post(f"{base_url}/insights", params={"query": "Why did VIX spike?", "user_id": "u1"})
    data = resp.json()
    assert data["level"] == "deep", f"Expected deep, got {data['level']}"
    assert "deepseek" in data["metadata"]["model"], "Expected DeepSeek model"
    assert data["reasoning"] is not None, "Deep response missing reasoning"
    print("✅ Deep Query Test Passed")

if __name__ == "__main__":
    test_api()
