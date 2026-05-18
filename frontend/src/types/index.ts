export interface FileDocument {
  path: string;
  content: string;
}

export interface FileNode {
  id: string;
  name: string;
  isDir: boolean;
  children?: FileNode[];
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface VectorDocument {
  id: string;
  text: string;
  metadata: {
    path: string;
    [key: string]: unknown;
  };
  embedding?: number[];
}
