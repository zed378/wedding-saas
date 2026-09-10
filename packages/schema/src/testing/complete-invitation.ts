import type { InvitationData } from "../invitation/invitation-data.js";

/**
 * P0-20 — an invitation with every canonical path filled.
 *
 * It exists to make one claim testable: that every path in `INVITATION_FIELDS` is
 * reachable in a real object. A registry is a list of strings, and a list of strings
 * that nothing walks is a list of strings that can drift from the data for a year
 * without anyone noticing.
 *
 * Exported from the package rather than kept in a spec file because two other things
 * need it: `P0-21`'s demo seed, which must fill exactly this set for the catalogue
 * preview to be honest, and the API's test factories.
 *
 * **Two events, not one**, so wildcard resolution is exercised against a collection
 * where the answer differs per element rather than one where every reading agrees.
 */
export const COMPLETE_INVITATION: InvitationData = {
  couple: {
    groom: {
      full_name: "Budi Santoso",
      nickname: "Budi",
      photo: "media/groom.jpg",
      instagram: "budisantoso",
      father_name: "Bapak Santoso",
      mother_name: "Ibu Rahayu",
      child_order: "Putra pertama dari dua bersaudara",
    },
    bride: {
      full_name: "Siti Nurhaliza",
      nickname: "Siti",
      photo: "media/bride.jpg",
      instagram: "sitinurhaliza",
      father_name: "Bapak Nurhalim",
      mother_name: "Ibu Dewi",
      child_order: "Putri kedua dari tiga bersaudara",
    },
  },
  events: [
    {
      type: "akad",
      title: "Akad Nikah",
      date: "2026-11-14",
      start_time: "08:00",
      end_time: "10:00",
      venue_name: "Masjid Al-Ikhlas",
      address: "Jl. Merdeka No. 12, Bandung",
      latitude: "-6.914744",
      longitude: "107.609810",
      maps_url: "https://maps.google.com/?q=-6.914744,107.609810",
      description: "Mohon hadir 15 menit sebelum acara dimulai.",
    },
    {
      type: "reception",
      title: "Resepsi",
      date: "2026-11-14",
      start_time: "11:00",
      end_time: "14:00",
      venue_name: "Gedung Serbaguna Merdeka",
      address: "Jl. Merdeka No. 20, Bandung",
      latitude: "-6.915000",
      longitude: "107.610000",
      maps_url: "https://maps.google.com/?q=-6.915000,107.610000",
      description: "Sesi foto bersama pukul 13.00.",
    },
  ],
  gallery: {
    photos: [
      {
        media_id: "11111111-1111-4111-8111-111111111111",
        caption: "Prewedding di Lembang",
        order: 0,
        is_cover: true,
      },
      {
        media_id: "22222222-2222-4222-8222-222222222222",
        caption: "Sesi kedua",
        order: 1,
        // `false` and `0` above are the two values that a naive `!value` emptiness
        // check would report as missing. They are here on purpose.
        is_cover: false,
      },
    ],
  },
  gift: {
    accounts: [
      {
        type: "bank",
        provider_name: "BCA",
        account_number: "1234567890",
        account_holder: "Budi Santoso",
        order: 0,
      },
      {
        type: "ewallet",
        provider_name: "GoPay",
        account_number: "081234567890",
        account_holder: "Siti Nurhaliza",
        order: 1,
      },
    ],
  },
  quote: {
    text: "Dan di antara tanda-tanda kekuasaan-Nya ialah Dia menciptakan untukmu pasangan hidup dari jenismu sendiri.",
    source: "QS. Ar-Rum: 21",
  },
};
