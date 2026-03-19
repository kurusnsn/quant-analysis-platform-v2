"""
SEC EDGAR Data Provider: Free access to SEC filings.
No API key required - public data.
"""
import os
import json
import hashlib
import requests
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional, List, Dict, Any
from tenacity import retry, stop_after_attempt, wait_exponential

CACHE_DIR = Path(os.getenv("EDGAR_CACHE_DIR", "./cache/edgar"))
CACHE_TTL_HOURS = 24
SEC_BASE_URL = "https://data.sec.gov"
SEC_HEADERS = {
    "User-Agent": "QuantPlatform Risk Analytics contact@quant-platform.app",
    "Accept-Encoding": "gzip, deflate"
}


class EdgarDataProvider:
    """
    SEC EDGAR API wrapper with caching and retry.
    Fetches company filings, CIK lookups, and filing content.
    """
    
    def __init__(self, cache_dir: Path = CACHE_DIR, cache_ttl_hours: int = CACHE_TTL_HOURS):
        self.cache_dir = cache_dir
        self.cache_ttl = timedelta(hours=cache_ttl_hours)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self._cik_cache: Dict[str, str] = {}
    
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
    
    @retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=10))
    def _fetch(self, url: str) -> Dict:
        response = requests.get(url, headers=SEC_HEADERS, timeout=15)
        response.raise_for_status()
        return response.json()
    
    def get_cik(self, ticker: str) -> Optional[str]:
        """Get CIK number for a ticker symbol."""
        ticker = ticker.upper()
        if ticker in self._cik_cache:
            return self._cik_cache[ticker]
        
        cache_key = self._cache_key(f"cik_{ticker}")
        cached = self._read_cache(cache_key)
        if cached:
            self._cik_cache[ticker] = cached
            return cached
        
        try:
            # SEC company tickers endpoint
            url = f"{SEC_BASE_URL}/submissions/CIK{ticker}.json"
            # Try ticker lookup first
            tickers_url = "https://www.sec.gov/files/company_tickers.json"
            response = requests.get(tickers_url, headers=SEC_HEADERS, timeout=10)
            response.raise_for_status()
            data = response.json()
            
            for item in data.values():
                if item.get("ticker", "").upper() == ticker:
                    cik = str(item["cik_str"]).zfill(10)
                    self._cik_cache[ticker] = cik
                    self._write_cache(cache_key, cik)
                    return cik
            return None
        except Exception:
            return None
    
    def get_recent_filings(self, ticker: str, filing_types: List[str] = None, limit: int = 10) -> List[Dict]:
        """
        Get recent SEC filings for a company.
        
        Args:
            ticker: Stock ticker symbol
            filing_types: Filter by form types (10-K, 10-Q, 8-K, etc.)
            limit: Maximum number of filings to return
        
        Returns:
            List of filing metadata dicts
        """
        if filing_types is None:
            filing_types = ["10-K", "10-Q", "8-K"]
        
        cache_key = self._cache_key(f"filings_{ticker}_{'-'.join(filing_types)}_{limit}")
        cached = self._read_cache(cache_key)
        if cached:
            return cached
        
        cik = self.get_cik(ticker)
        if not cik:
            return []
        
        try:
            url = f"{SEC_BASE_URL}/submissions/CIK{cik}.json"
            data = self._fetch(url)
            
            filings = []
            recent = data.get("filings", {}).get("recent", {})
            
            forms = recent.get("form", [])
            dates = recent.get("filingDate", [])
            accessions = recent.get("accessionNumber", [])
            descriptions = recent.get("primaryDocDescription", [])
            
            for i, form in enumerate(forms):
                if form in filing_types and len(filings) < limit:
                    filings.append({
                        "ticker": ticker,
                        "form": form,
                        "filing_date": dates[i] if i < len(dates) else None,
                        "accession_number": accessions[i] if i < len(accessions) else None,
                        "description": descriptions[i] if i < len(descriptions) else None,
                        "url": f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={cik}&type={form}"
                    })
            
            self._write_cache(cache_key, filings)
            return filings
        except Exception as e:
            return []
    
    def get_filings_for_watchlist(self, tickers: List[str], filing_types: List[str] = None) -> List[Dict]:
        """Get recent filings for all tickers in a watchlist."""
        all_filings = []
        for ticker in tickers:
            filings = self.get_recent_filings(ticker, filing_types, limit=3)
            all_filings.extend(filings)
        
        # Sort by date
        all_filings.sort(key=lambda x: x.get("filing_date", ""), reverse=True)
        return all_filings[:20]  # Return most recent 20


# Singleton instance
edgar_provider = EdgarDataProvider()
