import { describe, expect, it } from "vitest";
import { isPhotoUrl } from "./photo-url";

const thumb = (file: string) =>
  `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${encodeURIComponent(file)}/960px-${encodeURIComponent(file)}`;

describe("isPhotoUrl", () => {
  it("accepts real photos, including names that merely contain the words", () => {
    expect(isPhotoUrl(thumb("Colosseo_2020.jpg"))).toBe(true);
    expect(isPhotoUrl(thumb("Trevi_Fountain,_Rome,_Italy_2_-_May_2007.jpg"))).toBe(true);
    expect(isPhotoUrl(thumb("Pantheon_(Rome)_-_Right_side_and_front.jpg"))).toBe(true);
    expect(isPhotoUrl(thumb("Sealife_aquarium_Konstanz.jpg"))).toBe(true);
    expect(isPhotoUrl(thumb("Mappatura_Venezia_2019.jpg"))).toBe(true);
    for (const f of ["Seal_Rock_Oregon.jpg", "Elephant_seals_at_Piedras_Blancas.jpg", "Map_Room_White_House.jpg",
      "Icon_of_the_Seas.jpg", "Flags_at_UN_Headquarters.jpg", "Theotokos_icon_Tretyakov.jpg", "Icons_at_Sinai_monastery.jpg"])
      expect(isPhotoUrl(thumb(f)), f).toBe(true);
  });

  it("rejects logos, flags, maps, coats of arms and drawings", () => {
    // The real Galleria Borghese page image.
    expect(isPhotoUrl(thumb("Galleria_Borghese_-_logo_(Italy,_2022-).svg") + ".png")).toBe(false);
    expect(isPhotoUrl(thumb("Flag_of_Italy.svg") + ".png")).toBe(false);
    expect(isPhotoUrl(thumb("Italy_location_map.jpg"))).toBe(false);
    expect(isPhotoUrl(thumb("Flag_of_Japan.png"))).toBe(false);
    expect(isPhotoUrl(thumb("Map_of_Rome_1890.jpg"))).toBe(false);
    expect(isPhotoUrl(thumb("Coat_of_arms_of_Rome.png"))).toBe(false);
    expect(isPhotoUrl(thumb("Seal_of_New_York_City.png"))).toBe(false);
    expect(isPhotoUrl(thumb("Some_building.svg"))).toBe(false);
  });

  it("keeps non-Wikimedia photos (Google Places) and rejects empty or broken URLs", () => {
    expect(isPhotoUrl("https://places.googleapis.com/v1/places/abc/photos/xyz/media?maxWidthPx=800")).toBe(true);
    expect(isPhotoUrl("")).toBe(false);
    expect(isPhotoUrl(null)).toBe(false);
    expect(isPhotoUrl("not a url")).toBe(false);
  });
});
