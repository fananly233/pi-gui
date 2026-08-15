import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type ChangeEvent,
	type ClipboardEvent,
	type DragEvent,
	type KeyboardEvent,
} from "react";
import { desktopApi, type WorkspaceFileIndex } from "../api/desktop-api";
import type { ChatActivity, ChatDelivery, ChatImageAttachment } from "../chat/chat-types";
import {
	applyFileMention,
	extractFileMentionQuery,
	filterFileMentions,
	formatFileMention,
	type FileMentionQuery,
} from "../files/file-mentions";

const MAX_IMAGE_COUNT = 4;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const SUPPORTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

type ChatInputProps = {
	connected: boolean;
	activity: ChatActivity;
	sending: boolean;
	aborting: boolean;
	configuringModel: boolean;
	onSend: (text: string, delivery: ChatDelivery, attachments?: readonly ChatImageAttachment[]) => Promise<void>;
	onAbort: () => Promise<void>;
	seed: { id: number; text: string } | null;
	workspaceRoot: string | null;
	fileMentionSeed: { id: number; path: string } | null;
};

function fileMimeType(file: File): string {
	if (SUPPORTED_IMAGE_TYPES.has(file.type)) return file.type;
	const extension = file.name.split(".").at(-1)?.toLowerCase();
	if (extension === "png") return "image/png";
	if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
	if (extension === "webp") return "image/webp";
	if (extension === "gif") return "image/gif";
	return "";
}

function readImageData(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			const result = typeof reader.result === "string" ? reader.result : "";
			const comma = result.indexOf(",");
			if (comma === -1) reject(new Error(`Could not read ${file.name}.`));
			else resolve(result.slice(comma + 1));
		};
		reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}.`));
		reader.readAsDataURL(file);
	});
}

export function ChatInput({
	connected,
	activity,
	sending,
	aborting,
	configuringModel,
	onSend,
	onAbort,
	seed,
	workspaceRoot,
	fileMentionSeed,
}: ChatInputProps) {
	const [text, setText] = useState("");
	const [images, setImages] = useState<ChatImageAttachment[]>([]);
	const [attachmentError, setAttachmentError] = useState<string | null>(null);
	const [queuedDelivery, setQueuedDelivery] = useState<Exclude<ChatDelivery, "prompt">>("steer");
	const [mentionQuery, setMentionQuery] = useState<FileMentionQuery | null>(null);
	const [mentionMenuOpen, setMentionMenuOpen] = useState(false);
	const [mentionIndex, setMentionIndex] = useState(0);
	const [fileIndex, setFileIndex] = useState<(WorkspaceFileIndex & { workspaceRoot: string }) | null>(null);
	const [fileIndexLoading, setFileIndexLoading] = useState(false);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const imagesRef = useRef<ChatImageAttachment[]>([]);
	const running = activity !== "idle";
	const delivery: ChatDelivery = running ? queuedDelivery : "prompt";
	const canSend = connected && (text.trim().length > 0 || images.length > 0) && !sending && !configuringModel;

	useEffect(() => {
		imagesRef.current = images;
	}, [images]);

	useEffect(() => () => {
		for (const image of imagesRef.current) URL.revokeObjectURL(image.previewUrl);
	}, []);

	const clearImages = useCallback(() => {
		setImages((current) => {
			for (const image of current) URL.revokeObjectURL(image.previewUrl);
			return [];
		});
	}, []);

	useEffect(() => {
		if (!seed) return;
		setText(seed.text);
		setMentionQuery(null);
		setMentionMenuOpen(false);
		clearImages();
	}, [clearImages, seed]);

	useEffect(() => {
		if (!fileMentionSeed) return;
		setText((current) => {
			const separator = current.length === 0 || /\s$/.test(current) ? "" : " ";
			return `${current}${separator}${formatFileMention(fileMentionSeed.path)} `;
		});
		setMentionQuery(null);
		setMentionMenuOpen(false);
		requestAnimationFrame(() => textareaRef.current?.focus());
	}, [fileMentionSeed]);

	useEffect(() => {
		setFileIndex(null);
		setMentionQuery(null);
		setMentionMenuOpen(false);
	}, [workspaceRoot]);

	const updateMentionQuery = useCallback((value: string, caret: number | null) => {
		if (!workspaceRoot) {
			setMentionQuery(null);
			setMentionMenuOpen(false);
			return;
		}
		const query = extractFileMentionQuery(value.slice(0, caret ?? value.length));
		setMentionQuery(query);
		setMentionMenuOpen(query !== null);
		setMentionIndex(0);
	}, [workspaceRoot]);

	const mentionActive = mentionQuery !== null;

	useEffect(() => {
		if (!mentionActive || !workspaceRoot || fileIndex?.workspaceRoot === workspaceRoot) return;
		let cancelled = false;
		setFileIndexLoading(true);
		void desktopApi.indexWorkspaceFiles(workspaceRoot)
			.then((index) => {
				if (!cancelled) setFileIndex({ ...index, workspaceRoot });
			})
			.catch(() => {
				if (!cancelled) setFileIndex({ files: [], truncated: false, workspaceRoot });
			})
			.finally(() => {
				if (!cancelled) setFileIndexLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [fileIndex, mentionActive, workspaceRoot]);

	const mentionMatches = useMemo(
		() => mentionQuery && fileIndex?.workspaceRoot === workspaceRoot
			? filterFileMentions(fileIndex.files, mentionQuery.query, 20)
			: [],
		[fileIndex, mentionQuery, workspaceRoot],
	);

	useEffect(() => {
		if (mentionIndex >= mentionMatches.length) setMentionIndex(Math.max(0, mentionMatches.length - 1));
	}, [mentionIndex, mentionMatches.length]);

	const completeMention = (path: string) => {
		if (!mentionQuery) return;
		const textarea = textareaRef.current;
		const caret = textarea?.selectionStart ?? text.length;
		const next = applyFileMention(text, caret, mentionQuery, path);
		setText(next.text);
		setMentionQuery(null);
		setMentionMenuOpen(false);
		requestAnimationFrame(() => {
			textarea?.focus();
			textarea?.setSelectionRange(next.caret, next.caret);
		});
	};

	const prepareImages = useCallback(async (files: File[]) => {
		setAttachmentError(null);
		const remaining = MAX_IMAGE_COUNT - imagesRef.current.length;
		if (remaining <= 0) {
			setAttachmentError(`Attach up to ${MAX_IMAGE_COUNT} images per message.`);
			return;
		}
		const candidates = files.slice(0, remaining);
		const next: ChatImageAttachment[] = [];
		for (const file of candidates) {
			const mimeType = fileMimeType(file);
			if (!mimeType) {
				setAttachmentError("Only PNG, JPEG, WebP and GIF images are supported.");
				continue;
			}
			if (file.size > MAX_IMAGE_BYTES) {
				setAttachmentError(`${file.name} is larger than 5 MiB.`);
				continue;
			}
			try {
				next.push({
					name: file.name || "image",
					mimeType,
					data: await readImageData(file),
					previewUrl: URL.createObjectURL(file),
					size: file.size,
				});
			} catch (error) {
				setAttachmentError(error instanceof Error ? error.message : `Could not read ${file.name}.`);
			}
		}
		if (next.length) setImages((current) => [...current, ...next].slice(0, MAX_IMAGE_COUNT));
	}, []);

	const onFileInput = (event: ChangeEvent<HTMLInputElement>) => {
		void prepareImages(Array.from(event.target.files ?? []));
		event.target.value = "";
	};

	const removeImage = (index: number) => {
		setImages((current) => {
			const next = [...current];
			const [removed] = next.splice(index, 1);
			if (removed) URL.revokeObjectURL(removed.previewUrl);
			return next;
		});
	};

	const submit = () => {
		if (!canSend) return;
		const nextText = text;
		const nextImages = images;
		setText("");
		setImages([]);
		setMentionQuery(null);
		setMentionMenuOpen(false);
		setAttachmentError(null);
		void onSend(nextText, delivery, nextImages).finally(() => {
			for (const image of nextImages) URL.revokeObjectURL(image.previewUrl);
		});
	};

	const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if (mentionMenuOpen && mentionQuery && !event.nativeEvent.isComposing) {
			if (event.key === "ArrowDown") {
				event.preventDefault();
				setMentionIndex((value) => Math.min(Math.max(0, mentionMatches.length - 1), value + 1));
				return;
			}
			if (event.key === "ArrowUp") {
				event.preventDefault();
				setMentionIndex((value) => Math.max(0, value - 1));
				return;
			}
			if (event.key === "Escape") {
				event.preventDefault();
				setMentionMenuOpen(false);
				return;
			}
			if ((event.key === "Tab" || (event.key === "Enter" && !event.shiftKey)) && mentionMatches[mentionIndex]) {
				event.preventDefault();
				completeMention(mentionMatches[mentionIndex]);
				return;
			}
		}
		if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
		event.preventDefault();
		submit();
	};

	const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
		const pastedImages = Array.from(event.clipboardData.files).filter((file) => Boolean(fileMimeType(file)));
		if (!pastedImages.length) return;
		event.preventDefault();
		void prepareImages(pastedImages);
	};

	const onDrop = (event: DragEvent<HTMLDivElement>) => {
		const dropped = Array.from(event.dataTransfer.files);
		if (!dropped.length) return;
		event.preventDefault();
		const droppedImages = dropped.filter((file) => Boolean(fileMimeType(file)));
		if (droppedImages.length) void prepareImages(droppedImages);
		else setAttachmentError("Use the Files panel to reference project files with @path.");
	};

	return (
		<div className="composer" onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
			{running ? (
				<div className="composer__modes" aria-label="Queue behavior">
					<button type="button" className={queuedDelivery === "steer" ? "is-active" : ""} onClick={() => setQueuedDelivery("steer")}>Steer next turn</button>
					<button type="button" className={queuedDelivery === "followUp" ? "is-active" : ""} onClick={() => setQueuedDelivery("followUp")}>Follow up after finish</button>
				</div>
			) : null}
			<div className="composer__box">
				{mentionMenuOpen && mentionQuery ? (
					<div className="file-mention-menu" role="listbox" aria-label="Workspace file suggestions">
						<header><span>Files</span><small>{fileIndex?.truncated ? "first 5,000 indexed" : "Tab / Enter"}</small></header>
						{fileIndexLoading ? <p>Indexing workspace…</p> : null}
						{!fileIndexLoading && mentionMatches.length === 0 ? <p>No matching files</p> : null}
						{mentionMatches.map((path, index) => (
							<button
								key={path}
								type="button"
								className={index === mentionIndex ? "is-active" : ""}
								onMouseDown={(event) => {
									event.preventDefault();
									completeMention(path);
								}}
								onMouseEnter={() => setMentionIndex(index)}
								role="option"
								aria-selected={index === mentionIndex}
							>
								<span>{path.split("/").at(-1)}</span><small>{path}</small>
							</button>
						))}
					</div>
				) : null}
				{images.length ? (
					<div className="composer__attachments" aria-label="Pending image attachments">
						{images.map((image, index) => (
							<div className="composer__attachment" key={`${image.name}:${index}`} title={`${image.name} · ${(image.size / 1024).toFixed(1)} KiB`}>
								<img src={image.previewUrl} alt="" />
								<span>{image.name}</span>
								<button type="button" onClick={() => removeImage(index)} aria-label={`Remove ${image.name}`}>×</button>
							</div>
						))}
					</div>
				) : null}
				{attachmentError ? <p className="composer__attachment-error" role="alert">{attachmentError}</p> : null}
				<textarea
					ref={textareaRef}
					data-testid="chat-input"
					value={text}
					onChange={(event) => {
						setText(event.target.value);
						updateMentionQuery(event.target.value, event.target.selectionStart);
					}}
					onSelect={(event) => updateMentionQuery(event.currentTarget.value, event.currentTarget.selectionStart)}
					onKeyDown={onKeyDown}
					onPaste={onPaste}
					placeholder={configuringModel ? "Wait for Pi to finish configuring the model…" : connected ? (running ? "Add direction while Pi is working…" : "Ask Pi… Type @ for project files") : "Connect Pi to start chatting…"}
					disabled={!connected || configuringModel}
					rows={3}
				/>
				<div className="composer__actions">
					<div className="composer__hints">
						<input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden onChange={onFileInput} />
						<button type="button" className="composer__attach" onClick={() => fileInputRef.current?.click()} disabled={!connected || configuringModel || images.length >= MAX_IMAGE_COUNT} title="Attach images">＋ Image</button>
						<span>Enter to send · @ for files</span>
					</div>
					<div>
						{running ? (
							<button type="button" className="button button--danger" onClick={() => void onAbort()} disabled={aborting} data-testid="abort-button">
								{aborting ? "Stopping…" : "Stop"}
							</button>
						) : null}
						<button type="button" className="button button--primary" onClick={submit} disabled={!canSend} data-testid="send-button">
							{configuringModel ? "Configuring…" : sending ? "Sending…" : running ? (delivery === "steer" ? "Queue steer" : "Queue follow-up") : "Send"}
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
