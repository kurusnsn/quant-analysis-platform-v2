import sys
import os
import json
import pandas as pd
import yfinance as yf
from datetime import datetime
from typing import Dict, Any, List

def safe_get_statement(stock: yf.Ticker, attr_names: List[str]) -> pd.DataFrame:
    for name in attr_names:
        try:
            print(f"Trying attribute: {name}")
            data = getattr(stock, name, None)
            if callable(data):
                data = data()
            if isinstance(data, pd.DataFrame) and not data.empty:
                print(f"Success with {name}, shape: {data.shape}")
                return data
            else:
                print(f"Attribute {name} returned empty or None")
        except Exception as e:
            print(f"Error accessing {name}: {e}")
            continue
    return pd.DataFrame()

def normalize_statement(df: pd.DataFrame, max_periods: int) -> pd.DataFrame:
    if df is None or df.empty:
        return pd.DataFrame()
    df = df.copy()
    try:
        df = df.reindex(sorted(df.columns), axis=1)
    except Exception:
        pass
    if max_periods and df.shape[1] > max_periods:
        df = df.iloc[:, -max_periods:]
    return df

def coerce_value(value: Any) -> Any:
    if value is None:
        return None
    try:
        if pd.isna(value):
            return None
    except Exception:
        pass
    if isinstance(value, (pd.Timestamp, datetime)):
        return value.date().isoformat()
    if hasattr(value, 'item'): 
        return value.item()
    return value

def df_to_table(df: pd.DataFrame) -> Dict[str, Any]:
    if df is None or df.empty:
        return {"columns": [], "rows": []}

    columns = []
    for col in df.columns:
        if isinstance(col, (pd.Timestamp, datetime)):
            columns.append(col.date().isoformat())
        else:
            columns.append(str(col))

    rows = []
    for idx, row in df.iterrows():
        values = [coerce_value(v) for v in row.tolist()]
        if all(v is None for v in values):
            continue
        rows.append({
            "label": str(idx),
            "values": values
        })

    return {"columns": columns, "rows": rows}

def get_financials(ticker: str):
    print(f"Fetching financials for {ticker}...")
    stock = yf.Ticker(ticker)
    
    try:
        info = stock.info
        print(f"Info keys found: {len(info) if info else 0}")
    except Exception as e:
        print(f"Error fetching info: {e}")

    print("Fetching income statements...")
    df_income_annual = safe_get_statement(stock, ["income_stmt", "financials"])
    income_annual = normalize_statement(df_income_annual, 4)
    
    df_income_quarterly = safe_get_statement(stock, ["quarterly_income_stmt", "quarterly_financials"])
    income_quarterly = normalize_statement(df_income_quarterly, 8)

    print("Fetching balance sheets...")
    df_balance_annual = safe_get_statement(stock, ["balance_sheet"])
    balance_annual = normalize_statement(df_balance_annual, 4)

    df_balance_quarterly = safe_get_statement(stock, ["quarterly_balance_sheet"])
    balance_quarterly = normalize_statement(df_balance_quarterly, 8)

    print("Fetching cash flows...")
    df_cash_annual = safe_get_statement(stock, ["cashflow"])
    cash_annual = normalize_statement(df_cash_annual, 4)

    df_cash_quarterly = safe_get_statement(stock, ["quarterly_cashflow"])
    cash_quarterly = normalize_statement(df_cash_quarterly, 8)

    payload = {
        "ticker": ticker.upper(),
        "statements": {
            "income_statement": {
                "annual": df_to_table(income_annual),
                "quarterly": df_to_table(income_quarterly),
            },
            "balance_sheet": {
                "annual": df_to_table(balance_annual),
                "quarterly": df_to_table(balance_quarterly),
            },
            "cash_flow": {
                "annual": df_to_table(cash_annual),
                "quarterly": df_to_table(cash_quarterly),
            }
        }
    }
    return payload

if __name__ == "__main__":
    try:
        data = get_financials("AAPL")
        print("\nJSON Output Preview:")
        print(json.dumps(data, indent=2)[:500] + "...")
        
        inc_rows = len(data['statements']['income_statement']['annual']['rows'])
        print(f"\nIncome Statement Rows: {inc_rows}")
        print("Labels found in Income Statement:")
        for row in data['statements']['income_statement']['annual']['rows']:
            print(f" - {row['label']}")
        
        if inc_rows == 0:
            print("ERROR: No rows found in income statement!")
            sys.exit(1)
            
    except Exception as e:
        print(f"CRITICAL ERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)