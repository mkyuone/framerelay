export const stations = ['registration', 'photography', 'selection', 'printing'] as const;
export type Station = (typeof stations)[number];
export const stationNames: Record<Station, string> = {
  registration: 'Registration Station',
  photography: 'Photography Station',
  selection: 'Select & Edit Station',
  printing: 'Print Station',
};

export interface EventConfig {
  id: string;
  eventName: string;
  primaryColor: string;
  accentColor: string;
  footerText: string;
  selectionLimit: number;
  printEnabled: boolean;
  digitalEnabled: boolean;
  printWidth: number;
  printHeight: number;
  copies: number;
  downloadsEnabled: boolean;
  status: 'draft' | 'active' | 'closed';
}
export interface Photo {
  id: string;
  sessionId: string;
  number: number;
  filename: string;
  sourceName: string;
  width: number;
  height: number;
  excludedPhotography: boolean;
  excludedSelection: boolean;
  chosen: boolean;
  recipe: unknown | null;
  finalFilename: string | null;
  finalWidth: number | null;
  finalHeight: number | null;
  renderStatus: 'none' | 'pending' | 'processing' | 'ready' | 'failed';
  renderError: string | null;
  printed: boolean;
  printRevision: number;
}
export interface Ticket {
  id: string;
  eventId: string;
  code: string;
  identificationToken: string;
  deliveryPath: string | null;
  status: 'registered' | 'photographing' | 'ready' | 'submitted';
  createdAt: string;
  submittedAt: string | null;
  photos: Photo[];
  revision: number;
}
export interface Bootstrap {
  event: EventConfig | null;
  staff: boolean;
  operator: boolean;
}
export interface Preferences {
  footerOverride: string | null;
  qrSize: 'medium' | 'large';
  cameraId: string;
  thumbnailSize: 'comfortable' | 'large';
  queueDensity: 'comfortable' | 'compact';
  showCompleted: boolean;
  highlightZebras: boolean;
}
export const defaultPreferences: Preferences = {
  footerOverride: null,
  qrSize: 'large',
  cameraId: '',
  thumbnailSize: 'comfortable',
  queueDensity: 'comfortable',
  showCompleted: false,
  highlightZebras: true,
};
