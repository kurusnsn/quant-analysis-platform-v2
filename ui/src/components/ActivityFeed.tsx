
import React from 'react';

export const ActivityFeed: React.FC = () => {
    const activities = [
        { icon: 'bolt', title: 'Generated "AI Speculative" watchlist', desc: 'Used prompt "High-risk tech stocks..."', time: '2h ago', color: 'primary' },
        { icon: 'search', title: "Searched 'Crypto Liquidity Ratios'", desc: 'Global market search filter: Liquidity > $500M', time: '4h ago', color: 'slate' },
        { icon: 'bar_chart', title: "Exported 'Q3 Risk Assessment' PDF", desc: 'Sent to support@quant-platform.com', time: '6h ago', color: 'slate' },
        { icon: 'notifications_active', title: 'System Alert: Market Volatility Spike', desc: 'APAC Region: Real estate bonds underperforming', time: '1d ago', color: 'orange' },
    ];

    return (
        <section className="bg-surface rounded-2xl border border-border-color overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between px-6 py-5 border-b border-border-color">
                <div className="flex flex-col text-left">
                    <h2 className="text-foreground text-lg font-bold leading-tight">Recent Activity</h2>
                    <p className="text-muted text-xs font-normal mt-0.5">Live platform interaction logs</p>
                </div>
                <a className="text-xs font-bold uppercase tracking-widest text-primary flex items-center gap-1 hover:brightness-110 transition-all" href="#">
                    View All
                    <span className="material-symbols-outlined !text-sm">arrow_forward</span>
                </a>
            </div>

            <div className="flex flex-col divide-y divide-border-color/50">
                {activities.map((item, idx) => (
                    <div key={idx} className="flex items-center gap-4 bg-transparent px-6 py-4 hover:bg-black/5 transition-colors cursor-pointer group">
                        <div className={`flex items-center justify-center rounded-lg ${item.color === 'primary' ? 'bg-primary/10 text-primary' : item.color === 'orange' ? 'bg-orange-500/10 text-orange-400' : 'bg-border-color text-foreground'} shrink-0 size-11 group-hover:scale-110 transition-all`}>
                            <span className="material-symbols-outlined">{item.icon}</span>
                        </div>
                        <div className="flex flex-col flex-1 min-w-0 text-left">
                            <p className="text-foreground text-[15px] font-semibold leading-normal line-clamp-1">{item.title}</p>
                            <p className="text-muted text-sm font-normal line-clamp-1">{item.desc}</p>
                        </div>
                        <div className="shrink-0">
                            <p className="text-muted text-xs font-medium">{item.time}</p>
                        </div>
                    </div>
                ))}
            </div>

            <div className="px-6 py-4 bg-black/5 border-t border-border-color text-center">
                <button className="text-muted text-xs font-semibold hover:text-foreground transition-colors uppercase tracking-widest">
                    Load More Activity
                </button>
            </div>
        </section>
    );
};
