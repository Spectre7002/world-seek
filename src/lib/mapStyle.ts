// Monochromatic, kraft-tinted Google Maps style to match the eco-brutalist site
// theme. Everything renders in kraft/ink/moss earth tones — land in kraft, water
// in deep moss-ink (so land/water contrast stays readable for the geo-guessing
// game), labels in ink. Applied via the classic JSON `styles` option, which only
// works when the map has NO cloud `mapId` set (ours doesn't — see MapPicker).
export const EARTHY_MAP_STYLE: google.maps.MapTypeStyle[] = [
  // Base
  { elementType: "geometry", stylers: [{ color: "#d8c7a3" }] }, // land — kraft field
  { elementType: "labels.text.fill", stylers: [{ color: "#14110d" }] }, // labels — ink
  { elementType: "labels.text.stroke", stylers: [{ color: "#efe6cf" }] }, // label halo — pale kraft

  // De-clutter for a calmer, on-theme map
  { featureType: "poi", elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { featureType: "poi.business", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "administrative.land_parcel", stylers: [{ visibility: "off" }] },

  // Borders — ink for admin, muted ink for countries
  { featureType: "administrative", elementType: "geometry.stroke", stylers: [{ color: "#4a4338" }] },
  { featureType: "administrative.country", elementType: "geometry.stroke", stylers: [{ color: "#14110d" }] },

  // Land features
  { featureType: "landscape", elementType: "geometry", stylers: [{ color: "#d8c7a3" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#7d8a5a" }] }, // moss-tinted green

  // Roads — darker kraft so they read above the land
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#b8a577" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#7a6f4f" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#9a8a5f" }] },

  // Water — deep moss-ink so coastlines stay legible
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#3a4530" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#c9b68f" }] },
];
