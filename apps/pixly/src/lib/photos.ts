export interface Photo {
  id: string;
  seed: number;
  caption: string;
  place: string;
  likes: number;
  author?: string;
  /** Object URL for a photo the user uploaded in this session. */
  src?: string;
}

/** The signed-in user's library. Images are generated landscapes, not stock photos. */
export const LIBRARY: Photo[] = [
  { id: "p-ridge", seed: 1, caption: "Golden hour over the ridge", place: "Snowdonia", likes: 214 },
  { id: "p-lake", seed: 2, caption: "First light at the lake", place: "Lake District", likes: 98 },
  { id: "p-north", seed: 3, caption: "Blue hour, somewhere north", place: "Isle of Skye", likes: 176 },
  { id: "p-dunes", seed: 4, caption: "Dunes after the wind", place: "Merzouga", likes: 321 },
  { id: "p-pines", seed: 5, caption: "Pine silhouettes", place: "Cairngorms", likes: 143 },
  { id: "p-coast", seed: 6, caption: "Low tide, long shadows", place: "Pembrokeshire", likes: 87 },
];

/** Other people's photos, used for personalised recommendations. */
export const DISCOVER: Photo[] = [
  { id: "d-fjord", seed: 7, caption: "Fjord at dusk", place: "Lofoten", likes: 1204, author: "@mira.k" },
  { id: "d-canyon", seed: 8, caption: "Canyon, 6:42 am", place: "Utah", likes: 889, author: "@tomasz" },
  { id: "d-snow", seed: 9, caption: "The quiet after snow", place: "Hokkaido", likes: 2311, author: "@aiko" },
  { id: "d-meadow", seed: 10, caption: "Meadow before the storm", place: "Dolomites", likes: 640, author: "@leon" },
];
