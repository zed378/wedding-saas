"use client";

import { useState } from "react";

import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  Dropzone,
  Input,
  InteractiveCard,
  InvitationStatusBadge,
  Modal,
  Select,
  Skeleton,
  SkeletonList,
  Stepper,
  Table,
  Tabs,
  Textarea,
  useToast,
  type InvitationStatus,
  type SortDirection,
} from "@wi/ui";

/**
 * P0-22 — the component workbench.
 *
 * The card asks for "a component workbench (Storybook or equivalent) with an axe check
 * per story". This is the equivalent, and it is deliberately not Storybook.
 *
 * ## Why a route instead of Storybook
 *
 * Storybook is a second build, a second dev server, a second set of framework adapters
 * and a second place where a component can be configured differently from how it ships.
 * Its axe addon runs against Storybook's own rendering, not the app's.
 *
 * A route inside the real app has none of that. It is compiled by the app's build, uses
 * the app's stylesheet and the app's token values, and the axe pass over it runs in
 * `e2e/` -- the harness `P0-19` already built, in a real browser, where
 * **`color-contrast` actually works**. The jsdom pass in `@wi/ui` has that rule disabled
 * because jsdom has no layout engine, so this is the only place contrast is checked
 * against rendered pixels rather than against token arithmetic.
 *
 * ## The `data-story` contract
 *
 * Every story is a `<section data-story="...">`. `e2e/tests/workbench.e2e.ts` enumerates
 * them and runs axe against each one separately, so a violation names the component
 * rather than "the page". Adding a component here is what puts it under the browser axe
 * pass; nothing else does.
 */

export function Story({
  name,
  title,
  description,
  children,
}: {
  readonly name: string;
  readonly title: string;
  readonly description?: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section
      data-story={name}
      aria-labelledby={`story-${name}`}
      className="flex flex-col gap-4 border-b border-border pb-10"
    >
      <div className="flex flex-col gap-1">
        <h2 id={`story-${name}`} className="text-h2 font-semibold">
          {title}
        </h2>
        {description !== undefined && (
          <p className="text-body text-text-muted">{description}</p>
        )}
      </div>
      <div className="flex flex-col gap-6">{children}</div>
    </section>
  );
}

function Row({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-body-sm font-medium text-text-muted">{label}</p>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ Button */

export function ButtonStory() {
  return (
    <Story
      name="button"
      title="Button"
      description="Empat varian, tiga ukuran, dan setiap keadaan dari docs/UI-UX/06."
    >
      <Row label="Varian">
        <Button variant="primary">Simpan</Button>
        <Button variant="secondary">Batal</Button>
        <Button variant="ghost">Lihat detail</Button>
        <Button variant="danger">Hapus</Button>
      </Row>

      <Row label="Ukuran — semuanya tetap setinggi 44px (docs/UI-UX/09)">
        <Button size="sm">Kecil</Button>
        <Button size="md">Sedang</Button>
        <Button size="lg">Besar</Button>
      </Row>

      <Row label="Keadaan">
        <Button disabled>Nonaktif</Button>
        <Button loading>Menyimpan</Button>
        <Button variant="danger" loading>
          Menghapus
        </Button>
        <Button variant="secondary" disabled>
          Nonaktif
        </Button>
      </Row>
    </Story>
  );
}

/* ------------------------------------------------------------- form fields */

export function FieldStory() {
  const [value, setValue] = useState("");

  return (
    <Story
      name="fields"
      title="Input, Textarea, Select"
      description="Label selalu terkait; galat diumumkan, tidak hanya diwarnai."
    >
      <div className="grid gap-6 sm:grid-cols-2">
        <Input
          label="Nama panggilan mempelai pria"
          placeholder="Budi"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          required
        />
        <Input
          label="Slug undangan"
          helperText="Huruf kecil, angka, dan tanda hubung."
          defaultValue="budi-dan-siti"
        />
        <Input
          label="Email"
          type="email"
          error="Format email tidak valid."
          defaultValue="bukan-email"
        />
        <Input label="Nonaktif" disabled defaultValue="Tidak dapat diubah" />

        <Textarea
          label="Pesan penutup"
          helperText="Maksimal 500 karakter."
          defaultValue="Terima kasih atas doa restu Anda."
        />
        <Textarea label="Catatan" error="Terlalu panjang." defaultValue="..." />

        <Select
          label="Provinsi"
          placeholder="Pilih provinsi"
          options={[
            { value: "jabar", label: "Jawa Barat" },
            { value: "jateng", label: "Jawa Tengah" },
            { value: "jatim", label: "Jawa Timur" },
          ]}
        />
        <Select
          label="Kota"
          searchable
          options={[
            { value: "bdg", label: "Bandung" },
            { value: "smg", label: "Semarang" },
            { value: "sby", label: "Surabaya" },
            { value: "yog", label: "Yogyakarta" },
          ]}
        />
      </div>
    </Story>
  );
}

/* ---------------------------------------------------------------- Dropzone */

export function DropzoneStory() {
  const [picked, setPicked] = useState<readonly File[]>([]);

  return (
    <Story
      name="dropzone"
      title="Dropzone"
      description="Input berkas asli di baliknya — dapat diakses dengan papan ketik."
    >
      <div className="grid gap-6 sm:grid-cols-2">
        <Dropzone
          label="Foto galeri"
          helperText="JPEG, PNG, atau WebP. Maksimal 5 MB per foto."
          accept="image/jpeg,image/png,image/webp"
          multiple
          onFiles={setPicked}
        />
        <Dropzone
          label="Foto sedang diunggah"
          onFiles={() => {}}
          progress={62}
        />
        <Dropzone
          label="Berkas ditolak"
          error="Ukuran berkas melebihi 5 MB."
          onFiles={() => {}}
        />
        <Dropzone label="Nonaktif" disabled onFiles={() => {}} />
      </div>

      {picked.length > 0 && (
        <p className="text-body-sm text-text-muted">
          {picked.length} berkas dipilih.
        </p>
      )}
    </Story>
  );
}

/* ------------------------------------------------------------------- Badge */

const STATUSES: readonly InvitationStatus[] = [
  "draft",
  "pending_payment",
  "paid",
  "published",
  "expired",
  "soft_deleted",
];

export function BadgeStory() {
  return (
    <Story
      name="badge"
      title="Badge"
      description="Peta status undangan hidup di satu tempat saja (docs/UI-UX/08)."
    >
      <Row label="Status undangan">
        {STATUSES.map((status) => (
          <InvitationStatusBadge key={status} status={status} />
        ))}
      </Row>

      <Row label="Nada lain">
        <Badge tone="primary">Baru</Badge>
        <Badge tone="premium">Premium</Badge>
        <Badge tone="neutral">Netral</Badge>
      </Row>
    </Story>
  );
}

/* -------------------------------------------------------------------- Card */

export function CardStory() {
  return (
    <Story name="card" title="Card" description="Bingkai; isinya milik layar.">
      <div className="grid gap-6 sm:grid-cols-2">
        <Card>
          <CardHeader
            title="Elegant Rose"
            description="Modern, floral"
            actions={<Badge tone="premium">Premium</Badge>}
          />
          <p className="text-body">Rp 139.000 · 12 bulan</p>
        </Card>

        <InteractiveCard label="Pilih template Elegant Rose" onClick={() => {}}>
          <p className="text-h3 font-semibold">Elegant Rose</p>
          <p className="text-body text-text-muted">
            Kartu yang dapat diaktifkan — sebuah tombol sungguhan.
          </p>
        </InteractiveCard>
      </div>
    </Story>
  );
}

/* -------------------------------------------------------------------- Tabs */

export function TabsStory() {
  // Demo ids, deliberately NOT the product's section keys: a Tabs story does not need
  // the template vocabulary, and using it would need an exemption in
  // `scripts/check-no-hardcoded-fields.mjs` for the sake of a fixture.
  const [active, setActive] = useState("tab-one");

  return (
    <Story
      name="tabs"
      title="Tabs"
      description="Pola WAI-ARIA penuh: panah, Home/End, roving tabindex."
    >
      <Tabs
        label="Bagian undangan"
        activeId={active}
        onChange={setActive}
        items={[
          {
            id: "tab-one",
            label: "Mempelai",
            content: <p className="text-body">Data mempelai.</p>,
          },
          {
            id: "tab-two",
            label: "Acara",
            content: <p className="text-body">Akad dan resepsi.</p>,
          },
          {
            id: "tab-three",
            label: "Galeri",
            content: <p className="text-body">Foto prewedding.</p>,
          },
          {
            id: "tab-four",
            label: "Hadiah",
            content: <p className="text-body">Rekening.</p>,
            disabled: true,
          },
        ]}
      />
    </Story>
  );
}

/* ------------------------------------------------------------------- Table */

interface Guest {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly count: number;
}

const GUESTS: readonly Guest[] = [
  { id: "1", name: "Andi Pratama", status: "Hadir", count: 2 },
  { id: "2", name: "Rina Kusuma", status: "Mungkin", count: 1 },
  { id: "3", name: "Dimas Prayoga", status: "Tidak hadir", count: 1 },
];

export function TableStory() {
  const [sort, setSort] = useState<{ key: string; direction: SortDirection }>({
    key: "name",
    direction: "asc",
  });

  return (
    <Story
      name="table"
      title="Table"
      description="Tabel sungguhan, dengan caption dan aria-sort."
    >
      <Table
        caption="Daftar RSVP"
        rowKey={(g) => g.id}
        rows={GUESTS}
        sort={sort}
        onSortChange={(key, direction) => setSort({ key, direction })}
        columns={[
          {
            key: "name",
            header: "Nama tamu",
            render: (g) => g.name,
            sortable: true,
          },
          { key: "status", header: "Kehadiran", render: (g) => g.status },
          {
            key: "count",
            header: "Jumlah",
            render: (g) => g.count,
            numeric: true,
            sortable: true,
          },
        ]}
      />

      <Table
        caption="Daftar buku tamu (kosong)"
        rowKey={(g: Guest) => g.id}
        rows={[]}
        columns={[{ key: "name", header: "Nama", render: (g) => g.name }]}
      />
    </Story>
  );
}

/* ----------------------------------------------------------------- Stepper */

export function StepperStory() {
  return (
    <Story
      name="stepper"
      title="Stepper"
      description="Daftar berurutan; keadaan setiap langkah juga tertulis."
    >
      <Stepper
        label="Langkah pembuatan undangan"
        current={1}
        steps={[
          { id: "template", label: "Pilih template" },
          { id: "data", label: "Isi data" },
          { id: "pay", label: "Bayar" },
          { id: "publish", label: "Terbitkan" },
        ]}
      />
    </Story>
  );
}

/* ---------------------------------------------------------------- Skeleton */

export function SkeletonStory() {
  return (
    <Story
      name="skeleton"
      title="Skeleton"
      description="Disembunyikan dari pembaca layar; keadaan memuat diumumkan sekali."
    >
      <div className="flex flex-col gap-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="size-12" rounded="full" />
      </div>

      <SkeletonList rows={3} label="Memuat daftar undangan" />
    </Story>
  );
}

/* ------------------------------------------------------------------ Avatar */

export function AvatarStory() {
  return (
    <Story
      name="avatar"
      title="Avatar"
      description="Nama wajib — ia menjadi teks alternatif."
    >
      <Row label="Ukuran">
        <Avatar name="Budi Santoso" size="sm" />
        <Avatar name="Budi Santoso" size="md" />
        <Avatar name="Siti Nurhaliza" size="lg" />
        <Avatar name="Siti Nurhaliza" size="xl" showCropIndicator />
      </Row>
    </Story>
  );
}

/* ------------------------------------------------------------ Modal, Toast */

export function OverlayStory() {
  const [confirmation, setConfirmation] = useState(false);
  const [form, setForm] = useState(false);
  const { show } = useToast();

  return (
    <Story
      name="overlays"
      title="Modal dan Toast"
      description="Modal memakai <dialog> asli; galat tidak hilang sendiri."
    >
      <Row label="Modal">
        <Button variant="secondary" onClick={() => setConfirmation(true)}>
          Buka konfirmasi
        </Button>
        <Button variant="secondary" onClick={() => setForm(true)}>
          Buka formulir
        </Button>
      </Row>

      <Row label="Toast">
        <Button
          variant="secondary"
          onClick={() => show({ variant: "success", message: "Tersimpan." })}
        >
          Sukses
        </Button>
        <Button
          variant="secondary"
          onClick={() =>
            show({
              variant: "error",
              message: "Terjadi kesalahan. Silakan coba lagi.",
            })
          }
        >
          Galat
        </Button>
        <Button
          variant="secondary"
          onClick={() =>
            show({ variant: "warning", message: "Kuota hampir habis." })
          }
        >
          Peringatan
        </Button>
        <Button
          variant="secondary"
          onClick={() =>
            show({ variant: "info", message: "Undangan disalin." })
          }
        >
          Informasi
        </Button>
      </Row>

      <Modal
        open={confirmation}
        onClose={() => setConfirmation(false)}
        title="Hapus undangan?"
        description="Undangan dan seluruh datanya akan dihapus."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmation(false)}>
              Batal
            </Button>
            <Button variant="danger" onClick={() => setConfirmation(false)}>
              Hapus
            </Button>
          </>
        }
      />

      <Modal
        open={form}
        onClose={() => setForm(false)}
        title="Ubah nama undangan"
        size="form"
        footer={<Button onClick={() => setForm(false)}>Simpan</Button>}
      >
        <Input label="Nama internal" defaultValue="Budi & Siti" />
      </Modal>
    </Story>
  );
}
