#!/usr/bin/env python3
"""
Test what financial data yfinance provides
"""

import yfinance as yf
import json

ticker = yf.Ticker("AAPL")

print("=" * 80)
print("YFINANCE FINANCIAL DATA AVAILABLE")
print("=" * 80)

# 1. Company Info
print("\n1️⃣  COMPANY INFO")
print("-" * 40)
info = ticker.info
print(f"Company Name: {info.get('longName', 'N/A')}")
print(f"Sector: {info.get('sector', 'N/A')}")
print(f"Industry: {info.get('industry', 'N/A')}")
print(f"Employees: {info.get('fullTimeEmployees', 'N/A'):,}")
print(f"Website: {info.get('website', 'N/A')}")
print(f"Description: {info.get('longBusinessSummary', 'N/A')[:200]}...")

# 2. Key Metrics
print("\n2️⃣  KEY METRICS")
print("-" * 40)
print(f"Market Cap: ${info.get('marketCap', 0):,}")
print(f"P/E Ratio: {info.get('trailingPE', 'N/A')}")
print(f"Forward P/E: {info.get('forwardPE', 'N/A')}")
print(f"EPS (TTM): ${info.get('trailingEps', 'N/A')}")
print(f"Dividend Yield: {info.get('dividendYield', 0) * 100:.2f}%")
print(f"52W High: ${info.get('fiftyTwoWeekHigh', 'N/A')}")
print(f"52W Low: ${info.get('fiftyTwoWeekLow', 'N/A')}")
print(f"Avg Volume: {info.get('averageVolume', 'N/A'):,}")
print(f"Beta: {info.get('beta', 'N/A')}")

# 3. Income Statement
print("\n3️⃣  INCOME STATEMENT (Annual)")
print("-" * 40)
income_stmt = ticker.income_stmt
if not income_stmt.empty:
    latest = income_stmt.columns[0]
    print(f"Latest Period: {latest}")
    print(f"Total Revenue: ${income_stmt.loc['Total Revenue', latest]:,.0f}")
    print(f"Gross Profit: ${income_stmt.loc['Gross Profit', latest]:,.0f}")
    print(f"Operating Income: ${income_stmt.loc['Operating Income', latest]:,.0f}")
    print(f"Net Income: ${income_stmt.loc['Net Income', latest]:,.0f}")
    print(f"\nAvailable rows: {list(income_stmt.index[:10])}")

# 4. Balance Sheet
print("\n4️⃣  BALANCE SHEET (Annual)")
print("-" * 40)
balance = ticker.balance_sheet
if not balance.empty:
    latest = balance.columns[0]
    print(f"Latest Period: {latest}")
    print(f"Total Assets: ${balance.loc['Total Assets', latest]:,.0f}")
    print(f"Total Liabilities: ${balance.loc['Total Liabilities Net Minority Interest', latest]:,.0f}")
    print(f"Stockholder Equity: ${balance.loc['Stockholders Equity', latest]:,.0f}")
    print(f"Cash: ${balance.loc['Cash And Cash Equivalents', latest]:,.0f}")

# 5. Cash Flow
print("\n5️⃣  CASH FLOW (Annual)")
print("-" * 40)
cashflow = ticker.cashflow
if not cashflow.empty:
    latest = cashflow.columns[0]
    print(f"Latest Period: {latest}")
    print(f"Operating Cash Flow: ${cashflow.loc['Operating Cash Flow', latest]:,.0f}")
    print(f"Free Cash Flow: ${cashflow.loc['Free Cash Flow', latest]:,.0f}")
    print(f"Capital Expenditure: ${cashflow.loc['Capital Expenditure', latest]:,.0f}")

# 6. Quarterly Data Available?
print("\n6️⃣  QUARTERLY DATA AVAILABLE?")
print("-" * 40)
quarterly_income = ticker.quarterly_income_stmt
print(f"Quarterly Income Stmt: {not quarterly_income.empty} ({quarterly_income.shape[1]} periods)")
quarterly_balance = ticker.quarterly_balance_sheet
print(f"Quarterly Balance Sheet: {not quarterly_balance.empty} ({quarterly_balance.shape[1]} periods)")
quarterly_cashflow = ticker.quarterly_cashflow
print(f"Quarterly Cash Flow: {not quarterly_cashflow.empty} ({quarterly_cashflow.shape[1]} periods)")

# 7. Additional Data
print("\n7️⃣  ADDITIONAL DATA")
print("-" * 40)
print(f"Recommendations: {ticker.recommendations is not None}")
print(f"Institutional Holders: {ticker.institutional_holders is not None}")
print(f"Major Holders: {ticker.major_holders is not None}")
print(f"Calendar (Earnings): {ticker.calendar is not None}")

print("\n" + "=" * 80)
print("✅ ALL DATA FREE, NO API KEY NEEDED, NO RATE LIMITS")
print("=" * 80)
