import type { StyleSpecification } from 'maplibre-gl';

export type MapType = 'default' | 'satellite' | 'topo' | 'osm';

export const MAP_STYLES = {
    dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
    light: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
} as const;

export const SATELLITE_STYLE: StyleSpecification = {
    version: 8,
    glyphs: 'https://tiles.basemaps.cartocdn.com/fonts/{fontstack}/{range}.pbf',
    sources: {
        satellite: {
            type: 'raster',
            tiles: [
                'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
            ],
            tileSize: 256,
            maxzoom: 18,
            attribution: '<a href="https://www.esri.com/en-us/arcgis/products/arcgis-online/basemaps" target="_blank" rel="noopener noreferrer"> © Esri</a>',
        },
    },
    layers: [
        {
            id: 'satellite-base',
            type: 'raster',
            source: 'satellite',
            paint: { 'raster-fade-duration': 150 },
        },
    ],
};

export const TOPO_STYLE: StyleSpecification = {
    version: 8,
    glyphs: 'https://tiles.basemaps.cartocdn.com/fonts/{fontstack}/{range}.pbf',
    sources: {
        topo: {
            type: 'raster',
            tiles: ['https://tile.opentopomap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            maxzoom: 17,
            attribution: '<a href="https://opentopomap.org/about" target="_blank" rel="noopener noreferrer"> © OpenTopoMap</a> | <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer"> © OpenStreetMap</a>',
        },
    },
    layers: [
        {
            id: 'topo-base',
            type: 'raster',
            source: 'topo',
            paint: { 'raster-fade-duration': 150 },
        },
    ],
};

export const OSM_STYLE: StyleSpecification = {
    version: 8,
    glyphs: 'https://tiles.basemaps.cartocdn.com/fonts/{fontstack}/{range}.pbf',
    sources: {
        osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            maxzoom: 19,
            attribution: '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer"> © OpenStreetMap</a>',
        },
    },
    layers: [
        {
            id: 'osm-base',
            type: 'raster',
            source: 'osm',
            paint: { 'raster-fade-duration': 150 },
        },
    ],
};

export function getMapStyle(mapType: MapType, resolvedTheme: 'dark' | 'light'): StyleSpecification | string {
    switch (mapType) {
        case 'satellite':
            return SATELLITE_STYLE;
        case 'topo':
            return TOPO_STYLE;
        case 'osm':
            return OSM_STYLE;
        case 'default':
        default:
            return MAP_STYLES[resolvedTheme];
    }
}

// Ensure the application can list all valid map types for the UI select component dropdown.
// The label values should correspond to the mapType translations in the i18n locales.
export const MAP_TYPE_OPTIONS = [
    { value: 'default', labelKey: 'mapType.default' },
    { value: 'satellite', labelKey: 'mapType.satellite' },
    { value: 'topo', labelKey: 'mapType.topo' },
    { value: 'osm', labelKey: 'mapType.osm' },
];
