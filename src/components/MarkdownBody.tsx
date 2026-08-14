import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { open } from "@tauri-apps/plugin-shell";

function safeExternalUrl(value: string | undefined): string | null {
	if (!value) return null;
	try {
		const url = new URL(value);
		return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
	} catch {
		return null;
	}
}

export function MarkdownBody({ content }: { content: string }) {
	return (
		<div className="markdown-body">
			<ReactMarkdown
				remarkPlugins={[remarkGfm]}
				components={{
					a({ href, children }) {
						const externalUrl = safeExternalUrl(href);
						if (!externalUrl) return <span>{children}</span>;
						return (
							<a
								href={externalUrl}
								onClick={(event) => {
									event.preventDefault();
									void open(externalUrl);
								}}
							>
								{children}
							</a>
						);
					},
					img({ alt }) {
						return <span className="markdown-image-placeholder">[Image: {alt || "preview unavailable"}]</span>;
					},
				}}
			>
				{content}
			</ReactMarkdown>
		</div>
	);
}
