import { useRef, useState } from "react";
import { RelativeTime } from "@/components/ui/relative-time";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listContactDocuments,
  deleteContactDocument,
  getContactUploadToken,
  getSignedUploadUrl,
  recordDocumentUpload,
} from "@/lib/dashboard/documents.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  FileText, FileImage, FileSpreadsheet, FileArchive,
  Trash2, Download, Link2, UploadCloud, Loader2, FolderOpen, Copy, Check,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  contactId: string;
  contactName?: string | null;
  uploadToken?: string | null;
}

function fileIcon(mime?: string | null) {
  if (!mime) return FileText;
  if (mime.startsWith("image/"))        return FileImage;
  if (mime === "application/pdf")       return FileText;
  if (mime.includes("spreadsheet") || mime.includes("excel") || mime.includes("csv")) return FileSpreadsheet;
  if (mime.includes("zip") || mime.includes("rar") || mime.includes("tar")) return FileArchive;
  return FileText;
}

function fmtSize(bytes?: number | null) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

export function ContactDocumentsPanel({ contactId, contactName, uploadToken: tokenProp }: Props) {
  const qc         = useQueryClient();
  const listFn     = useServerFn(listContactDocuments);
  const deleteFn   = useServerFn(deleteContactDocument);
  const getTokenFn = useServerFn(getContactUploadToken);
  const getUrlFn   = useServerFn(getSignedUploadUrl);
  const recordFn   = useServerFn(recordDocumentUpload);

  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging,   setDragging]   = useState(false);
  const [uploading,  setUploading]  = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [copied,     setCopied]     = useState(false);

  const docsQ = useQuery({
    queryKey: ["contact-docs", contactId],
    queryFn:  () => listFn({ data: { contactId } }),
    staleTime: 0,
  });

  const tokenQ = useQuery({
    queryKey: ["contact-upload-token", contactId],
    queryFn:  async () => {
      if (tokenProp) return { uploadToken: tokenProp, name: contactName ?? null, phone: "" };
      return getTokenFn({ data: { contactId } });
    },
    staleTime: Infinity,
    retry: 1,
  });

  const docs   = (docsQ.data ?? []) as any[];
  const token  = tokenQ.data?.uploadToken ?? null;
  const uploadUrl = token ? `${window.location.origin}/upload/${token}` : null;

  function copyLink() {
    if (!uploadUrl) return;
    navigator.clipboard.writeText(uploadUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  async function handleAdminUpload(files: FileList | null) {
    if (!files?.length || !token) return;
    setUploading(true);
    let ok = 0;
    let fail = 0;
    for (const file of Array.from(files)) {
      try {
        const info = await getUrlFn({ data: { token, fileName: file.name, mimeType: file.type || undefined } });
        const put  = await fetch(info.signedUrl, {
          method: "PUT",
          body: file,
          headers: { "Content-Type": file.type || "application/octet-stream" },
        });
        if (!put.ok) throw new Error("Storage upload failed");
        await recordFn({
          data: {
            uploadToken: token,
            fileName:    file.name,
            fileSize:    file.size,
            mimeType:    file.type || undefined,
            storagePath: info.storagePath,
            publicUrl:   info.publicUrl,
            uploadedBy:  "admin",
          },
        });
        ok++;
      } catch (e: any) {
        fail++;
        toast.error(`${file.name}: ${e.message}`);
      }
    }
    setUploading(false);
    if (inputRef.current) inputRef.current.value = "";
    if (ok) {
      qc.invalidateQueries({ queryKey: ["contact-docs", contactId] });
      toast.success(`${ok} file${ok > 1 ? "s" : ""} uploaded`);
    }
  }

  const del = useMutation({
    mutationFn: (doc: any) => {
      setDeletingId(doc.id);
      return deleteFn({ data: { id: doc.id, storagePath: doc.storage_path } });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contact-docs", contactId] });
      setDeletingId(null);
    },
    onError: (e: any) => {
      setDeletingId(null);
      toast.error(e.message);
    },
  });

  return (
    <div className="space-y-4">

      {/* Upload link */}
      <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
        <div className="flex items-center gap-2">
          <Link2 className="h-3.5 w-3.5 text-primary shrink-0" />
          <p className="text-xs font-medium">Client Upload Link</p>
        </div>
        {tokenQ.isLoading ? (
          <div className="flex items-center gap-1.5">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            <p className="text-xs text-muted-foreground">Generating link…</p>
          </div>
        ) : uploadUrl ? (
          <>
            <p className="text-[11px] text-muted-foreground break-all font-mono bg-background/60 rounded px-2 py-1.5">
              {uploadUrl}
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1.5 flex-1"
                onClick={copyLink}
              >
                {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "Copied!" : "Copy link"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1.5 flex-1"
                onClick={() => {
                  if (!uploadUrl) return;
                  const sms = `sms:?&body=Hi, please upload your documents here: ${uploadUrl}`;
                  window.open(sms, "_blank");
                }}
              >
                Send via SMS
              </Button>
            </div>
          </>
        ) : (
          <p className="text-xs text-muted-foreground/60 italic">
            Upload link unavailable — apply the database migration first.
          </p>
        )}
      </div>

      {/* Admin upload */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); handleAdminUpload(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
        className={cn(
          "border-2 border-dashed rounded-lg px-4 py-5 text-center cursor-pointer transition-colors",
          dragging
            ? "border-primary bg-primary/5"
            : "border-border hover:border-primary/40 hover:bg-muted/20",
        )}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => handleAdminUpload(e.target.files)}
        />
        {uploading ? (
          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Uploading…
          </div>
        ) : (
          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <UploadCloud className="h-4 w-4" />
            Drop files here or click to upload
          </div>
        )}
      </div>

      {/* Documents list */}
      {docsQ.isLoading ? (
        <div className="flex justify-center py-4">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : docs.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-6 text-muted-foreground">
          <FolderOpen className="h-8 w-8 opacity-30" />
          <p className="text-xs">No documents yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {docs.map((doc: any) => {
            const Icon = fileIcon(doc.mime_type);
            return (
              <div
                key={doc.id}
                className="flex items-center gap-3 rounded-lg border border-border bg-muted/20 px-3 py-2.5"
              >
                <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{doc.file_name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    {doc.file_size && (
                      <span className="text-[10px] text-muted-foreground">{fmtSize(doc.file_size)}</span>
                    )}
                    <Badge variant="secondary" className="text-[10px] px-1 py-0">
                      {doc.uploaded_by === "admin" ? "Admin" : "Client"}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">
                      <RelativeTime date={doc.created_at} />
                    </span>
                  </div>
                </div>
                <a
                  href={doc.public_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  title="Download"
                >
                  <Download className="h-3.5 w-3.5" />
                </a>
                <button
                  onClick={() => del.mutate(doc)}
                  disabled={deletingId === doc.id}
                  className="text-muted-foreground hover:text-destructive transition-colors"
                  title="Delete"
                >
                  {deletingId === doc.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
