import type { Vector3 } from 'three';
import type { AnnotationBodyItem } from '../features/annotationBody';

export interface AnnotationLink {
  id: string;
  type?: string;
  label?: string | string[] | Record<string, string | string[]>;
  format?: string;
}

// An Image body of an Annotation: a picture of the annotated place
// (W3C Web Annotation allows several bodies; IIIF image service optional).
export interface AnnotationImage {
  id: string;
  label?: string;
  format?: string;
  // IIIF Image API service base URL, used to request a thumbnail
  service?: string;
  // W3C purpose of the body: 'linking' = a related resource; otherwise the image
  // shows the annotated place ('describing' or none)
  purpose?: string;
  // Page that describes the image (the holding institution's record)
  homepage?: string;
  homepageLabel?: string;
}

export interface AnnotationTag {
  key?: string;
  value: string;
}

export interface Annotation {
  id: string;
  creator: string;
  title: string;
  description: string;
  media: [];
  wikidata: [];
  bibliography: [];
  position: {
    x: number;
    y: number;
    z: number;
  };
  target_manifest?: string;
  seeAlso?: AnnotationLink[];
  // id of the target Specific Resource. Annotations with the same regionId
  // annotate the same region (Shared Region extension).
  regionId?: string;
  // Tagging bodies. `key` comes from the body's label (Keyed Tag extension).
  tags?: AnnotationTag[];
  // Image bodies (pictures of the annotated place)
  images?: AnnotationImage[];
  // Every body, in the reader's language (one item of each Choice). The description, the tags and the
  // images above are read from them; the card shows the others (otherBodies).
  bodies?: AnnotationBodyItem[];
  created?: string;
  data: {
    body: {
      value: string;
      label: string;
    };
    target: {
      selector: {
        type: string;
        value: [number, number, number];
        area: [number, number, number];
        camPos: [number, number, number];
        // Where the manifest camera looks (its lookAt), when it says so
        camLookAt?: [number, number, number];
        normal?: [number, number, number];
      };
    };
  };
}

export interface NewAnnotation {
  id: string;
  creator: string;
  title: string;
  description: string;
  media: [];
  wikidata: [];
  bibliography: [];
  position: {
    x: number;
    y: number;
    z: number;
  };
  target_manifest: string;
  target_canvas: string;
  data: {
    body: {
      value: unknown; // formerly an unresolved `OutputData` (hidden by skipLibCheck in the .d.ts)
      label: string;
      type: string;
    };
    target: {
      selector: {
        type: string;
        value: [number, number, number];
        area: [number, number, number];
        camPos: [number, number, number];
        normal?: [number, number, number];
      };
    };
  };
}

export interface IIIFAnnotation {
  id: string;
  type: string;
  motivation: string;
  body: { value: string; label: string; type: string };
  target: { source: string; selector: { value: [number, number, number]; type: string } };
}
interface MediaItem {
  type: string;
  source: string;
  caption: string;
}

interface WikidataItem {
  type: string;
  label: string;
  uri: string;
  wikipedia?: string;
  lat?: string;
  lng?: string;
}

interface BibliographyItem {
  author: string;
  title: string;
  year: string;
  page?: string;
  pdf?: string;
}

export interface InfoPanelContent {
  id: string;
  creator: string;
  title: string;
  description: string;
  media: MediaItem[];
  wikidata: WikidataItem[];
  bibliography: BibliographyItem[];
}

export interface Annotation3 {
  id: string;
  position: Vector3;
  content: string;
  cameraPosition: Vector3;
  targetPosition: Vector3;
}
