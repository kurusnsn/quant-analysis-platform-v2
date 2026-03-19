"use client";
import { devConsole } from "@/lib/devLog";

import { useState } from "react";

interface ShareDownloadButtonsProps {
    /** The text content to share/download */
    content: string;
    /** Optional markdown-specific content */
    markdownContent?: string;
    /** Optional PDF-specific content */
    pdfContent?: string;
    /** Filename for download (without extension) */
    filename?: string;
    /** Title for share dialog */
    title?: string;
    /** Additional class names */
    className?: string;
    /** Compact variant shows only icons */
    variant?: "default" | "compact";
    /** Enable markdown export button */
    enableMarkdownExport?: boolean;
    /** Enable PDF export button */
    enablePdfExport?: boolean;
}

export default function ShareDownloadButtons({
    content,
    markdownContent,
    pdfContent,
    filename = "insight",
    title = "quant-platform Insight",
    className = "",
    variant = "default",
    enableMarkdownExport = false,
    enablePdfExport = false,
}: ShareDownloadButtonsProps) {
    const [copied, setCopied] = useState(false);
    const [pdfExporting, setPdfExporting] = useState(false);

    const downloadBlob = (blob: Blob, extension: string) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${filename}.${extension}`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    };

    const handleShare = async () => {
        if (!content) return;

        // Check for Web Share API support
        if (typeof navigator !== "undefined" && navigator.share) {
            try {
                await navigator.share({
                    title,
                    text: content,
                });
                return;
            } catch (err) {
                // User cancelled or share failed, fallback to copy
                if (err instanceof Error && err.name === "AbortError") return;
            }
        }

        // Fallback: copy to clipboard
        try {
            await navigator.clipboard.writeText(content);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            devConsole.error("Failed to copy to clipboard");
        }
    };

    const handleDownload = () => {
        if (!content) return;

        const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
        downloadBlob(blob, "txt");
    };

    const handleMarkdownDownload = () => {
        const source = markdownContent || content;
        if (!source) return;

        const blob = new Blob([source], { type: "text/markdown;charset=utf-8" });
        downloadBlob(blob, "md");
    };

    const handlePdfDownload = async () => {
        const source = pdfContent || markdownContent || content;
        if (!source || pdfExporting) return;

        setPdfExporting(true);
        try {
            const { jsPDF } = await import("jspdf");
            const doc = new jsPDF({ unit: "pt", format: "a4" });
            const margin = 48;
            const pageWidth = doc.internal.pageSize.getWidth();
            const pageHeight = doc.internal.pageSize.getHeight();
            const contentWidth = pageWidth - margin * 2;
            const footerZone = 44; // reserve for footer
            let y = margin;

            const accentHex = "#6366f1";
            const fgHex = "#18181b";
            const mutedHex = "#71717a";
            const ruleHex = "#e4e4e7";

            const ensureSpace = (needed: number) => {
                if (y + needed > pageHeight - margin - footerZone) {
                    doc.addPage();
                    y = margin;
                }
            };

            const drawWrapped = (text: string, x: number, maxW: number, lineH: number) => {
                const wrapped: string[] = doc.splitTextToSize(text, maxW);
                for (const wLine of wrapped) {
                    ensureSpace(lineH);
                    doc.text(wLine, x, y);
                    y += lineH;
                }
            };

            // --- Header bar with logo ---
            const headerH = 56;
            doc.setFillColor(24, 24, 27);
            doc.rect(0, 0, pageWidth, headerH, "F");

            // Load logo
            try {
                const logoResp = await fetch("/logo-dark-mode.png");
                const logoBlob = await logoResp.blob();
                const logoDataUrl = await new Promise<string>((resolve) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result as string);
                    reader.readAsDataURL(logoBlob);
                });
                const logoH = 32;
                const logoW = 32;
                doc.addImage(logoDataUrl, "PNG", margin, (headerH - logoH) / 2, logoW, logoH);
                doc.setFont("helvetica", "bold");
                doc.setFontSize(16);
                doc.setTextColor(255, 255, 255);
                doc.text("quant-platform", margin + logoW + 8, 36);
            } catch {
                // Fallback: text only
                doc.setFont("helvetica", "bold");
                doc.setFontSize(16);
                doc.setTextColor(255, 255, 255);
                doc.text("quant-platform", margin, 36);
            }

            doc.setFont("helvetica", "normal");
            doc.setFontSize(9);
            doc.setTextColor(180, 180, 180);
            const dateStr = new Date().toLocaleDateString("en-US", {
                year: "numeric",
                month: "long",
                day: "numeric",
            });
            doc.text(dateStr, pageWidth - margin, 36, { align: "right" });
            y = headerH + 28;

            // --- Pre-process: merge consecutive paragraph lines into single blocks ---
            const rawLines = source.split("\n");
            type Block =
                | { type: "empty" }
                | { type: "h1"; text: string }
                | { type: "h2"; text: string }
                | { type: "h3"; text: string }
                | { type: "hr" }
                | { type: "bullet"; text: string }
                | { type: "paragraph"; text: string };

            const blocks: Block[] = [];
            let paragraphBuf: string[] = [];

            const flushParagraph = () => {
                if (paragraphBuf.length > 0) {
                    blocks.push({ type: "paragraph", text: paragraphBuf.join(" ") });
                    paragraphBuf = [];
                }
            };

            for (const raw of rawLines) {
                if (raw.trim() === "") {
                    flushParagraph();
                    blocks.push({ type: "empty" });
                } else if (/^# /.test(raw)) {
                    flushParagraph();
                    blocks.push({ type: "h1", text: raw.replace(/^# /, "").trim() });
                } else if (/^## /.test(raw)) {
                    flushParagraph();
                    blocks.push({ type: "h2", text: raw.replace(/^## /, "").trim() });
                } else if (/^### /.test(raw)) {
                    flushParagraph();
                    blocks.push({ type: "h3", text: raw.replace(/^### /, "").trim() });
                } else if (/^[-*_]{3,}\s*$/.test(raw)) {
                    flushParagraph();
                    blocks.push({ type: "hr" });
                } else if (/^[-*] /.test(raw)) {
                    flushParagraph();
                    blocks.push({ type: "bullet", text: raw.replace(/^[-*] /, "") });
                } else {
                    paragraphBuf.push(raw.trim());
                }
            }
            flushParagraph();

            // --- Strip markdown inline formatting ---
            const stripMd = (text: string) =>
                text
                    .replace(/\*\*([^*]+)\*\*/g, "$1")
                    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

            // --- Render blocks ---
            let startIdx = 0;
            // Title from first H1
            const firstH1 = blocks.findIndex((b) => b.type === "h1");
            if (firstH1 !== -1) {
                const b = blocks[firstH1] as { type: "h1"; text: string };
                doc.setFont("helvetica", "bold");
                doc.setFontSize(20);
                doc.setTextColor(fgHex);
                drawWrapped(stripMd(b.text), margin, contentWidth, 26);
                y += 6;
                doc.setDrawColor(accentHex);
                doc.setLineWidth(2.5);
                doc.line(margin, y, margin + 80, y);
                y += 18;
                startIdx = firstH1 + 1;
            }

            for (let i = startIdx; i < blocks.length; i++) {
                const block = blocks[i];

                switch (block.type) {
                    case "empty":
                        y += 8;
                        break;

                    case "h1": {
                        y += 14;
                        ensureSpace(28);
                        doc.setFont("helvetica", "bold");
                        doc.setFontSize(18);
                        doc.setTextColor(fgHex);
                        drawWrapped(stripMd(block.text), margin, contentWidth, 24);
                        y += 4;
                        break;
                    }

                    case "h2": {
                        y += 10;
                        ensureSpace(24);
                        doc.setFont("helvetica", "bold");
                        doc.setFontSize(14);
                        doc.setTextColor(accentHex);
                        drawWrapped(stripMd(block.text), margin, contentWidth, 20);
                        doc.setDrawColor(ruleHex);
                        doc.setLineWidth(0.5);
                        doc.line(margin, y, pageWidth - margin, y);
                        y += 6;
                        break;
                    }

                    case "h3": {
                        y += 6;
                        ensureSpace(20);
                        doc.setFont("helvetica", "bold");
                        doc.setFontSize(12);
                        doc.setTextColor(fgHex);
                        drawWrapped(stripMd(block.text), margin, contentWidth, 18);
                        break;
                    }

                    case "hr": {
                        ensureSpace(16);
                        y += 6;
                        doc.setDrawColor(ruleHex);
                        doc.setLineWidth(0.75);
                        doc.line(margin, y, pageWidth - margin, y);
                        y += 12;
                        break;
                    }

                    case "bullet": {
                        const text = stripMd(block.text);
                        ensureSpace(14);
                        doc.setFont("helvetica", "normal");
                        doc.setFontSize(10);
                        doc.setTextColor(fgHex);
                        doc.setFillColor(accentHex);
                        doc.circle(margin + 4, y - 3, 2, "F");
                        drawWrapped(text, margin + 14, contentWidth - 14, 14);
                        y += 2;
                        break;
                    }

                    case "paragraph": {
                        const text = stripMd(block.text);
                        doc.setFont("helvetica", "normal");
                        doc.setFontSize(10);
                        doc.setTextColor(mutedHex);
                        drawWrapped(text, margin, contentWidth, 14);
                        y += 4;
                        break;
                    }
                }
            }

            // --- Footer on every page ---
            const totalPages = doc.getNumberOfPages();
            for (let p = 1; p <= totalPages; p++) {
                doc.setPage(p);
                doc.setFont("helvetica", "normal");
                doc.setFontSize(8);
                doc.setTextColor(mutedHex);
                const footerY = pageHeight - 24;
                doc.text(`quant-platform — ${title}`, margin, footerY);
                doc.text(`Page ${p} of ${totalPages}`, pageWidth - margin, footerY, { align: "right" });
                doc.setDrawColor(ruleHex);
                doc.setLineWidth(0.5);
                doc.line(margin, footerY - 12, pageWidth - margin, footerY - 12);
            }

            doc.save(`${filename}.pdf`);
        } catch (error) {
            devConsole.error("Failed to generate PDF", error);
        } finally {
            setPdfExporting(false);
        }
    };

    const isCompact = variant === "compact";

    return (
        <div className={`flex items-center gap-1 ${className}`}>
            <button
                type="button"
                onClick={handleShare}
                className="flex items-center gap-1 p-1.5 text-muted hover:text-primary transition-colors rounded-md hover:bg-surface-highlight"
                title={copied ? "Copied!" : "Share"}
            >
                <span className="material-symbols-outlined text-base">
                    {copied ? "check_circle" : "share"}
                </span>
                {!isCompact && (
                    <span className="text-[10px] font-medium uppercase tracking-wider">
                        {copied ? "Copied" : "Share"}
                    </span>
                )}
            </button>
            <button
                type="button"
                onClick={handleDownload}
                className="flex items-center gap-1 p-1.5 text-muted hover:text-primary transition-colors rounded-md hover:bg-surface-highlight"
                title="Download"
            >
                <span className="material-symbols-outlined text-base">download</span>
                {!isCompact && (
                    <span className="text-[10px] font-medium uppercase tracking-wider">
                        Download
                    </span>
                )}
            </button>
            {enableMarkdownExport ? (
                <button
                    type="button"
                    onClick={handleMarkdownDownload}
                    className="flex items-center gap-1 p-1.5 text-muted hover:text-primary transition-colors rounded-md hover:bg-surface-highlight"
                    title="Download Markdown"
                >
                    <span className="material-symbols-outlined text-base">description</span>
                    {!isCompact && (
                        <span className="text-[10px] font-medium uppercase tracking-wider">
                            Markdown
                        </span>
                    )}
                </button>
            ) : null}
            {enablePdfExport ? (
                <button
                    type="button"
                    onClick={() => void handlePdfDownload()}
                    disabled={pdfExporting}
                    className="flex items-center gap-1 p-1.5 text-muted hover:text-primary transition-colors rounded-md hover:bg-surface-highlight disabled:cursor-not-allowed disabled:opacity-60"
                    title={pdfExporting ? "Exporting PDF..." : "Download PDF"}
                >
                    <span className="material-symbols-outlined text-base">
                        {pdfExporting ? "hourglass_top" : "picture_as_pdf"}
                    </span>
                    {!isCompact && (
                        <span className="text-[10px] font-medium uppercase tracking-wider">
                            {pdfExporting ? "Exporting" : "PDF"}
                        </span>
                    )}
                </button>
            ) : null}
        </div>
    );
}
