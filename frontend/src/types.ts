export interface Collection {
  id:           string;
  name:         string;
  color:        string;
  source_count: number;
  created_at:   string;
  updated_at:   string;
}

export interface Source {
  id:            string;
  collection_id: string;
  type:          'file' | 'url';
  name:          string;
  path?:         string;
  url?:          string;
  mime_type?:    string;
  size_bytes?:   number;
  status:        'pending' | 'processing' | 'indexed' | 'failed';
  error_text?:   string;
  created_at:    string;
}

export interface Chat {
  id:            string;
  collection_id: string;
  title:         string;
  created_at:    string;
}

export interface Message {
  id:         string;
  chat_id:    string;
  role:       'user' | 'assistant';
  content:    string;
  source_ids: string[];
  sources?:   { id: string; name: string }[];
  created_at: string;
}

export interface SourceMeta {
  id:   string;
  name: string;
}

export interface SearchResult {
  collection_id:    string;
  collection_name:  string;
  collection_color: string;
  match_count:      number;
  snippet:          string;
}

export interface AppSettings {
  brain_name:   string;
  llm_model?:   string;
  model_config: {
    tier:       string;
    llm:        string;
    whisper:    string;
    ram_gb:     number;
    vram_gb:    number;
  };
}

export interface Connection {
  source_a_id:   string;
  source_b_id:   string;
  source_a_name: string;
  source_b_name: string;
  similarity:    number;
}

export type Theme = 'light' | 'dark' | 'system';
export type ActiveTab = 'sources' | 'chat' | 'guide' | 'connections';
