/**
 * Seeded dummy wedding invitation data for live admin template preview.
 * docs/PLAN/07 § Demo Data
 */
export const DUMMY_INVITATION_DATA: Record<string, unknown> = {
  couple: {
    groom: {
      nickname: "Budi",
      full_name: "Raden Mas Budi Santoso",
      father_name: "Bapak Bambang Santoso",
      mother_name: "Ibu Sri Rahayu",
      child_order: "Putra pertama",
      instagram: "budisantoso",
      photo: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&q=80",
    },
    bride: {
      nickname: "Siti",
      full_name: "Siti Nurhaliza Putri",
      father_name: "Bapak H. Nurhalim",
      mother_name: "Ibu Hj. Dewi Lestari",
      child_order: "Putri kedua",
      instagram: "sitinurhaliza",
      photo: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400&q=80",
    },
  },
  events: [
    {
      id: "evt-akad",
      type: "ceremony",
      title: "Akad Nikah",
      date: "2026-12-12",
      start_time: "08:00",
      end_time: "10:00",
      timezone: "WIB",
      venue_name: "Masjid Raya Al-Bayan",
      address: "Jl. Diponegoro No. 45, Bandung, Jawa Barat",
      maps_url: "https://maps.google.com/?q=Bandung",
      description: "Diharapkan hadir 15 menit sebelum acara dimulai.",
    },
    {
      id: "evt-reception",
      type: "reception",
      title: "Resepsi Pernikahan",
      date: "2026-12-12",
      start_time: "11:00",
      end_time: "14:00",
      timezone: "WIB",
      venue_name: "Grand Ballroom Hotel Savoy Homann",
      address: "Jl. Asia Afrika No. 112, Bandung, Jawa Barat",
      maps_url: "https://maps.google.com/?q=Bandung",
      description: "Acara ramah tamah dan jamuan makan siang.",
    },
  ],
  gallery: {
    photos: [
      {
        id: "p1",
        url: "https://images.unsplash.com/photo-1519741497674-611481863552?w=800&q=80",
        caption: "Momen bahagia kebersamaan kami",
      },
      {
        id: "p2",
        url: "https://images.unsplash.com/photo-1511285560929-80b456fea0bc?w=800&q=80",
        caption: "Langkah awal menuju masa depan",
      },
      {
        id: "p3",
        url: "https://images.unsplash.com/photo-1465495976277-4387d4b0b4c6?w=800&q=80",
        caption: "Kenangan indah pra-nikah",
      },
      {
        id: "p4",
        url: "https://images.unsplash.com/photo-1583939003579-730e3918a45a?w=800&q=80",
        caption: "Senyuman terhangat",
      },
    ],
  },
  quote: {
    text: "Dan di antara tanda-tanda (kebesaran)-Nya ialah Dia menciptakan pasangan-pasangan untukmu dari jenismu sendiri, agar kamu cenderung dan merasa tenteram kepadanya, dan Dia menjadikan di antaramu rasa kasih dan sayang.",
    source: "QS. Ar-Rum: 21",
  },
  gifts: [
    {
      id: "g1",
      provider_name: "Bank Central Asia (BCA)",
      account_number: "1234567890",
      account_holder: "Budi Santoso",
    },
    {
      id: "g2",
      provider_name: "Bank Mandiri",
      account_number: "9876543210123",
      account_holder: "Siti Nurhaliza",
    },
  ],
};
