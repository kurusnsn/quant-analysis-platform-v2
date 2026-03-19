"""
Reddit Data Provider: Fetches social sentiment from r/stocks using praw.
Feature-flagged - requires REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USER_AGENT.
"""
import os
import json
import hashlib
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional, List, Dict, Any

CACHE_DIR = Path(os.getenv("REDDIT_CACHE_DIR", "./cache/reddit"))
CACHE_TTL_HOURS = 1  # Reddit data is more time-sensitive

# Feature flag - only enabled if credentials exist
REDDIT_ENABLED = all([
    os.getenv("REDDIT_CLIENT_ID"),
    os.getenv("REDDIT_CLIENT_SECRET"),
    os.getenv("REDDIT_USER_AGENT", "QuantPlatform/1.0")
])


class RedditDataProvider:
    """
    Reddit API wrapper with caching and graceful fallback.
    Feature-flagged: works when credentials exist, returns mock data otherwise.
    """
    
    def __init__(self, cache_dir: Path = CACHE_DIR, cache_ttl_hours: int = CACHE_TTL_HOURS):
        self.cache_dir = cache_dir
        self.cache_ttl = timedelta(hours=cache_ttl_hours)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.reddit = None
        self.enabled = REDDIT_ENABLED
        
        if self.enabled:
            self._init_reddit()
    
    def _init_reddit(self):
        """Initialize praw client."""
        try:
            import praw
            self.reddit = praw.Reddit(
                client_id=os.getenv("REDDIT_CLIENT_ID"),
                client_secret=os.getenv("REDDIT_CLIENT_SECRET"),
                user_agent=os.getenv("REDDIT_USER_AGENT", "QuantPlatform/1.0")
            )
        except Exception as e:
            print(f"Failed to initialize Reddit client: {e}")
            self.enabled = False
    
    def _cache_key(self, identifier: str) -> str:
        return hashlib.md5(identifier.encode()).hexdigest()
    
    def _cache_path(self, cache_key: str) -> Path:
        return self.cache_dir / f"{cache_key}.json"
    
    def _read_cache(self, cache_key: str) -> Optional[Any]:
        path = self._cache_path(cache_key)
        if not path.exists():
            return None
        try:
            with open(path, 'r') as f:
                data = json.load(f)
            cached_at = datetime.fromisoformat(data.get("cached_at", "2000-01-01"))
            if datetime.utcnow() - cached_at > self.cache_ttl:
                return None
            return data.get("payload")
        except (json.JSONDecodeError, KeyError):
            return None
    
    def _write_cache(self, cache_key: str, payload: Any):
        path = self._cache_path(cache_key)
        with open(path, 'w') as f:
            json.dump({
                "cached_at": datetime.utcnow().isoformat(),
                "payload": payload
            }, f)
    
    def get_social_mentions(self, ticker: str, subreddit: str = "stocks", limit: int = 20) -> List[Dict]:
        """
        Get recent Reddit posts/comments mentioning a ticker.
        
        Args:
            ticker: Stock ticker symbol
            subreddit: Subreddit to search (default: stocks)
            limit: Maximum posts to return
        
        Returns:
            List of posts with title, score, created_utc
        """
        ticker = ticker.upper()
        cache_key = self._cache_key(f"reddit_{subreddit}_{ticker}_{limit}")
        
        # Try cache first
        cached = self._read_cache(cache_key)
        if cached is not None:
            return cached
        
        if not self.enabled or not self.reddit:
            return self._mock_mentions(ticker)
        
        try:
            subreddit_obj = self.reddit.subreddit(subreddit)
            posts = []
            
            # Search for ticker mentions
            for submission in subreddit_obj.search(ticker, limit=limit, sort="new"):
                posts.append({
                    "title": submission.title,
                    "text": submission.selftext[:500] if submission.selftext else "",
                    "score": submission.score,
                    "num_comments": submission.num_comments,
                    "created_utc": datetime.fromtimestamp(submission.created_utc).isoformat(),
                    "url": f"https://reddit.com{submission.permalink}",
                    "ticker": ticker
                })
            
            self._write_cache(cache_key, posts)
            return posts
            
        except Exception as e:
            print(f"Reddit API error: {e}")
            return self._mock_mentions(ticker)
    
    def _mock_mentions(self, ticker: str) -> List[Dict]:
        """Return mock data when Reddit is unavailable."""
        return [
            {
                "title": f"[MOCK] Discussion about ${ticker}",
                "text": "This is mock data. Configure REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET for real data.",
                "score": 0,
                "num_comments": 0,
                "created_utc": datetime.utcnow().isoformat(),
                "url": "#",
                "ticker": ticker,
                "mock": True
            }
        ]
    
    def get_mentions_for_watchlist(self, tickers: List[str], limit_per_ticker: int = 5) -> List[Dict]:
        """Get Reddit mentions for all tickers in a watchlist."""
        all_mentions = []
        for ticker in tickers:
            mentions = self.get_social_mentions(ticker, limit=limit_per_ticker)
            all_mentions.extend(mentions)
        
        # Sort by score
        all_mentions.sort(key=lambda x: x.get("score", 0), reverse=True)
        return all_mentions[:20]


# Singleton instance
reddit_provider = RedditDataProvider()
