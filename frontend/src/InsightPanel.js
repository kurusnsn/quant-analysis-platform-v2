import React, { useState, useEffect } from 'react';

// Insight Levels
const LEVELS = {
  BRIEF: 'brief',
  STANDARD: 'standard',
  DEEP: 'deep'
};

const InsightPanel = ({ citations = [] }) => {
  const [level, setLevel] = useState(LEVELS.BRIEF);
  const [loading, setLoading] = useState(false);
  const [model, setModel] = useState("llama-3.1"); // Default
  const [data, setData] = useState(null);

  // Simulate API call based on level
  useEffect(() => {
    fetchInsights(level);
  }, [level]);

  const fetchInsights = async (selectedLevel) => {
    setLoading(true);
    // In real app, this is a fetch() to our FastAPI
    // Mocking response delay and data structure
    setTimeout(() => {
      const isDeep = selectedLevel === LEVELS.DEEP;
      setData({
        level: selectedLevel,
        summary: isDeep 
          ? "The market is experiencing a complex volatility event due to..." 
          : "Market is slightly bullish today.",
        reasoning: isDeep ? "Step 1: Analyzed VIX. Step 2: Correlated with Bond Yields..." : null,
        metadata: {
           model: isDeep ? "deepseek-r1-distill" : "llama-3.1"
        }
      });
      setModel(isDeep ? "deepseek-r1-distill" : "llama-3.1");
      setLoading(false);
    }, 800);
  };

  return (
    <div className="p-4 border rounded shadow-sm bg-white">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-bold">Market Insights</h2>
        <div className="flex gap-2">
          <button 
            className={`px-3 py-1 rounded ${level === LEVELS.BRIEF ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
            onClick={() => setLevel(LEVELS.BRIEF)}
          >
            Brief Overview
          </button>
          <button 
            className={`px-3 py-1 rounded ${level === LEVELS.DEEP ? 'bg-purple-600 text-white' : 'bg-gray-200'}`}
            onClick={() => setLevel(LEVELS.DEEP)}
          >
            Deep Dive
          </button>
        </div>
      </div>

      <div className="mb-2 text-xs text-gray-500 uppercase tracking-wide">
        Powered by: <span className="font-mono font-semibold">{model}</span>
      </div>

      {loading ? (
        <div className="animate-pulse text-gray-400">
          {level === LEVELS.DEEP ? "Reasoning..." : "Loading..."}
        </div>
      ) : (
        <div>
           <p className="text-gray-800 leading-relaxed mb-4">{data?.summary}</p>
           
           {data?.reasoning && (
             <div className="bg-purple-50 p-3 rounded text-sm text-purple-900 border border-purple-100">
               <strong>Reasoning Chain:</strong>
               <p className="mt-1">{data.reasoning}</p>
             </div>
           )}

           {citations.length > 0 && (
             <div className="mt-4 pt-4 border-t text-xs text-gray-500">
               <strong>Sources:</strong>
               <ul className="list-disc pl-4 mt-1">
                 {citations.map((c, i) => (
                   <li key={i}>
                     <a href={c.url} className="text-blue-600 hover:underline">{c.source}</a>
                   </li>
                 ))}
               </ul>
             </div>
           )}
        </div>
      )}
    </div>
  );
};

export default InsightPanel;
