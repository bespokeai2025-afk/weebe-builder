export interface VideoGenerateParams {
  prompt: string;
  durationSeconds?: number;
  aspectRatio?: "16:9" | "9:16" | "1:1";
  style?: string;
  referenceUrl?: string;
}

export interface VideoGenerateResult {
  jobId: string;
  status: "pending" | "processing" | "completed" | "failed";
  videoUrl?: string;
  thumbnailUrl?: string;
  estimatedSeconds?: number;
}

export interface VideoProvider {
  readonly name: string;
  generate(params: VideoGenerateParams): Promise<VideoGenerateResult>;
  pollStatus(jobId: string): Promise<VideoGenerateResult>;
  healthCheck?(): Promise<boolean>;
}
