'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { Viewer } from 'iiif-kasane';
// 3D の Scene も表示する（three.js などは 3D を開いたときだけ読み込まれる）
import 'iiif-kasane/scene';
import { buttonClass } from '@nakamura196/react-ui';
import CommonLayout from '@/components/layout/Common';
import { HIDDEN_VIEWER_TABS } from '@/lib/viewerTabs';
import { LocalImageError, filesFromDataTransfer, labelOf, readLocalImages } from '@/lib/localImage';
import {
  DEFAULT_SETTINGS,
  RIGHTS_CHOICES,
  buildManifest,
  imageUrlOf,
  manifestIdOf,
  move,
  pageLabelOf,
  problemsOf,
  serverPathOf,
  type EditorPage,
  type EditorSettings,
} from '@/lib/manifestEditor';

// /manifest-editor: 手元の画像から、ほかの場所でも使えるマニフェストを作ってダウンロードする。
// 画像はこのタブの中だけで読み（大きさを測り、プレビューに使う）、どこにも送らない。
// ダウンロードするマニフェストの画像の URL は、利用者が入力した「画像を置く場所」から作る。

// 置き場所・権利・帰属は同じ人が何度も同じものを入れるので、この端末に覚えておく（画像やページは覚えない）
const REMEMBERED: (keyof EditorSettings)[] = ['hosting', 'imageBase', 'language', 'rights', 'attribution'];
const STORAGE_KEY = 'kasane:manifest-editor';

const loadRemembered = (): Partial<EditorSettings> => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<EditorSettings>) : {};
  } catch {
    return {};
  }
};

const dragHasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes('Files');

const inputClass =
  'w-full px-3 py-2 rounded-md border border-[var(--ds-border)] bg-[var(--ds-bg)] text-[var(--ds-fg)] placeholder-[var(--ds-fg-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--ds-ring)]';
const smallInputClass =
  'w-full px-2 py-1 text-sm rounded border border-[var(--ds-border)] bg-[var(--ds-bg)] text-[var(--ds-fg)] focus:outline-none focus:ring-2 focus:ring-[var(--ds-ring)]';

function Field({ label, note, children }: { label: string; note?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="block text-sm font-medium text-[var(--ds-fg)]">{label}</span>
      {children}
      {note && <span className="block text-xs text-[var(--ds-fg-muted)] break-words">{note}</span>}
    </label>
  );
}

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded border border-[var(--ds-border)] p-4">
      <h2 className="text-base font-semibold text-[var(--ds-fg)]">
        <span className="mr-2 text-[var(--ds-fg-muted)]">{n}.</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function ManifestEditorContent() {
  const t = useTranslations('ManifestEditor');
  const tl = useTranslations('LocalImage');
  const locale = useLocale() === 'en' ? 'en' : 'ja';
  const { resolvedTheme } = useTheme();

  const [pages, setPages] = useState<EditorPage[]>([]);
  const [settings, setSettings] = useState<EditorSettings>(DEFAULT_SETTINGS);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [skipped, setSkipped] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [copied, setCopied] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  // 覚えておいた置き場所などを読む（サーバで描くときは localStorage が無いので、開いた後に読む）
  // （描いた直後に同期で入れると描き直しが続くので、一拍おいて入れる）
  const loaded = useRef(false);
  useEffect(() => {
    void Promise.resolve().then(() => {
      setSettings((s) => ({ ...s, ...loadRemembered() }));
      loaded.current = true;
    });
  }, []);
  useEffect(() => {
    if (!loaded.current) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(REMEMBERED.map((k) => [k, settings[k]]))));
    } catch {
      // 覚えられなくても作業はできる
    }
  }, [settings]);

  const set = <K extends keyof EditorSettings>(key: K, value: EditorSettings[K]) =>
    setSettings((s) => ({ ...s, [key]: value }));

  // 画像の blob: URL は、ページから外したときと、このページを離れるときに捨てる
  const pagesRef = useRef(pages);
  useEffect(() => {
    pagesRef.current = pages;
  }, [pages]);
  useEffect(() => () => pagesRef.current.forEach((p) => URL.revokeObjectURL(p.previewUrl)), []);

  const addFiles = useCallback(
    async (files: File[]) => {
      setError('');
      try {
        const { images, skipped: s } = await readLocalImages(files, (done, total) => {
          if (total > 1) setStatus(tl('reading', { done, total }));
        });
        setSkipped(s.length);
        const have = new Set(pagesRef.current.map((p) => p.key));
        const added: EditorPage[] = images
          .filter((im) => !have.has(im.digest))
          .map((im) => ({
            key: im.digest,
            label: pageLabelOf(im.name),
            path: serverPathOf(im.path),
            width: im.width,
            height: im.height,
            format: im.format,
            previewUrl: URL.createObjectURL(im.file),
          }));
        // 資料の名前の初期値: フォルダごと選んだらフォルダ名、1 枚だけならその画像の名前。
        // ばらばらのファイルを複数選んだときは、1 枚目の名前を資料の名前にすると紛らわしいので空のままにする
        if (!pagesRef.current.length) {
          const inFolder = images.some((im) => im.path.includes('/'));
          const name =
            images.length === 1
              ? pageLabelOf(images[0].name)
              : inFolder
                ? labelOf(images.map((im) => ({ name: im.name, webkitRelativePath: im.path })))
                : '';
          if (name) setSettings((st) => (st.label ? st : { ...st, label: name }));
        }
        setPages((ps) => [...ps, ...added]);
      } catch (e) {
        setError(tl(e instanceof LocalImageError ? e.reason : 'decode'));
      } finally {
        setStatus('');
      }
    },
    [tl],
  );

  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length) void addFiles(files);
  };

  const removePage = (i: number) =>
    setPages((ps) => {
      URL.revokeObjectURL(ps[i].previewUrl);
      return ps.filter((_, j) => j !== i);
    });
  const editPage = (i: number, patch: Partial<EditorPage>) =>
    setPages((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const clearPages = () => {
    pages.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    setPages([]);
    setSkipped(0);
  };

  // プレビュー: 手元の画像を指すマニフェストを、少し待ってから作り直す（入力のたびにビューアを読み直さない）
  useEffect(() => {
    if (!pages.length) return;
    let url = '';
    const timer = setTimeout(() => {
      const json = JSON.stringify(buildManifest(settings, pages, { preview: true }));
      url = URL.createObjectURL(new Blob([json], { type: 'application/ld+json' }));
      setPreviewUrl(url);
    }, 400);
    return () => {
      clearTimeout(timer);
      // 次のプレビューに替わった後で捨てる（ビューアが読み終わる前に捨てない）
      if (url) setTimeout(() => URL.revokeObjectURL(url), 5000);
    };
  }, [settings, pages]);

  const problems = problemsOf(settings, pages);
  const json = useMemo(() => JSON.stringify(buildManifest(settings, pages), null, 2), [settings, pages]);
  const manifestId = manifestIdOf(settings);
  const fileName = (() => {
    const last = manifestId.split('/').pop() || '';
    return /\.json$/i.test(last) ? last : 'manifest.json';
  })();

  const download = () => {
    const url = URL.createObjectURL(new Blob([json + '\n'], { type: 'application/ld+json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 書き込めないブラウザでは何もしない（下の欄から選んで写せる）
    }
  };

  const example = pages[0]?.path || '001.jpg';
  const baseOk = !problems.includes('imageBase');

  return (
    <CommonLayout>
      <div
        className="relative px-4 py-8 sm:px-8 bg-[var(--ds-bg)]"
        onDragOver={(e) => {
          if (!dragHasFiles(e)) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
          setDragging(false);
        }}
        onDrop={(e) => {
          if (!dragHasFiles(e)) return;
          e.preventDefault();
          setDragging(false);
          void filesFromDataTransfer(e.dataTransfer).then((files) => (files.length ? addFiles(files) : undefined));
        }}
      >
        {dragging && (
          <div className="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-lg border-4 border-dashed border-[var(--ds-ring)] bg-[var(--ds-bg)]/80 text-lg font-medium text-[var(--ds-fg)]">
            {t('dropHere')}
          </div>
        )}
        <div className="mx-auto max-w-7xl space-y-6">
          <div className="space-y-2">
            <h1 className="text-2xl font-bold text-[var(--ds-fg)]">{t('title')}</h1>
            <p className="text-sm text-[var(--ds-fg-muted)]">{t('lead')}</p>
            <p className="text-sm text-[var(--ds-fg-muted)]">{t('privacy')}</p>
          </div>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
            <div className="min-w-0 space-y-4">
              <Section n={1} title={t('step1')}>
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  data-testid="editor-image-input"
                  onChange={pick}
                />
                <input
                  ref={folderInput}
                  type="file"
                  {...{ webkitdirectory: '', directory: '' }}
                  className="hidden"
                  data-testid="editor-folder-input"
                  onChange={pick}
                />
                <div className="flex flex-col sm:flex-row gap-2">
                  <button type="button" onClick={() => fileInput.current?.click()} className={buttonClass('secondary', 'md', 'w-full sm:flex-1')}>
                    {pages.length ? t('addImages') : t('pickImages')}
                  </button>
                  <button type="button" onClick={() => folderInput.current?.click()} className={buttonClass('secondary', 'md', 'w-full sm:flex-1')}>
                    {t('pickFolder')}
                  </button>
                </div>
                <p className="text-xs text-[var(--ds-fg-muted)]">{t('pickNote')}</p>
                {status && (
                  <p className="text-sm text-[var(--ds-fg-muted)]" role="status">
                    {status}
                  </p>
                )}
                {error && (
                  <p className="text-sm text-red-600 dark:text-red-400" role="alert">
                    {error}
                  </p>
                )}
                {skipped > 0 && <p className="text-xs text-[var(--ds-fg-muted)]">{tl('skipped', { count: skipped })}</p>}
              </Section>

              <Section n={2} title={t('step2')}>
                <fieldset className="space-y-1">
                  <legend className="sr-only">{t('hosting')}</legend>
                  {(['files', 'iiif3', 'iiif2'] as const).map((h) => (
                    <label key={h} className="flex items-start gap-2 text-sm text-[var(--ds-fg)]">
                      <input
                        type="radio"
                        name="hosting"
                        className="mt-1"
                        checked={settings.hosting === h}
                        onChange={() => set('hosting', h)}
                      />
                      <span>{t(`hosting_${h}`)}</span>
                    </label>
                  ))}
                </fieldset>
                <Field
                  label={settings.hosting === 'files' ? t('imageBaseFiles') : t('imageBaseIiif')}
                  note={
                    baseOk ? (
                      <>
                        {t('imageUrlExample')} <code className="break-all">{imageUrlOf(settings, example)}</code>
                      </>
                    ) : (
                      t(settings.hosting === 'files' ? 'imageBaseNoteFiles' : 'imageBaseNoteIiif')
                    )
                  }
                >
                  <input
                    type="url"
                    className={inputClass}
                    value={settings.imageBase}
                    placeholder={settings.hosting === 'files' ? 'https://example.org/images/book1/' : 'https://example.org/iiif/3/'}
                    onChange={(e) => set('imageBase', e.target.value)}
                    data-testid="editor-image-base"
                  />
                </Field>
                <Field
                  label={t('manifestId')}
                  note={settings.hosting === 'files' ? t('manifestIdNoteFiles') : t('manifestIdNoteIiif')}
                >
                  <input
                    type="url"
                    className={inputClass}
                    value={settings.manifestId}
                    placeholder={manifestIdOf({ ...settings, manifestId: '' }) || 'https://example.org/manifests/book1.json'}
                    onChange={(e) => set('manifestId', e.target.value)}
                    data-testid="editor-manifest-id"
                  />
                </Field>
              </Section>

              <Section n={3} title={t('step3')}>
                <Field label={t('label')}>
                  <input type="text" className={inputClass} value={settings.label} onChange={(e) => set('label', e.target.value)} />
                </Field>
                <Field label={t('language')} note={t('languageNote')}>
                  <select
                    className={inputClass}
                    value={settings.language}
                    onChange={(e) => set('language', e.target.value as EditorSettings['language'])}
                  >
                    <option value="none">{t('language_none')}</option>
                    <option value="ja">{t('language_ja')}</option>
                    <option value="en">{t('language_en')}</option>
                  </select>
                </Field>
                <Field label={t('summary')}>
                  <textarea rows={2} className={inputClass} value={settings.summary} onChange={(e) => set('summary', e.target.value)} />
                </Field>
                <Field label={t('rights')} note={problems.includes('rights') ? t('rightsInvalid') : t('rightsNote')}>
                  <input
                    type="url"
                    list="kasane-rights"
                    className={inputClass}
                    value={settings.rights}
                    placeholder="http://creativecommons.org/licenses/by/4.0/"
                    onChange={(e) => set('rights', e.target.value)}
                  />
                  <datalist id="kasane-rights">
                    {RIGHTS_CHOICES.map((r) => (
                      <option key={r} value={r} />
                    ))}
                  </datalist>
                </Field>
                <Field label={t('attribution')}>
                  <input type="text" className={inputClass} value={settings.attribution} onChange={(e) => set('attribution', e.target.value)} />
                </Field>
                <label className="flex items-center gap-2 text-sm text-[var(--ds-fg)]">
                  <input
                    type="checkbox"
                    checked={settings.viewingDirection === 'right-to-left'}
                    onChange={(e) => set('viewingDirection', e.target.checked ? 'right-to-left' : 'left-to-right')}
                  />
                  {t('rightToLeft')}
                </label>
                <label className="flex items-center gap-2 text-sm text-[var(--ds-fg)]">
                  <input type="checkbox" checked={settings.paged} onChange={(e) => set('paged', e.target.checked)} />
                  {t('paged')}
                </label>
              </Section>

              <Section n={4} title={t('step4')}>
                {problems.length > 0 && (
                  <ul className="list-disc pl-5 text-sm text-red-600 dark:text-red-400" data-testid="editor-problems">
                    {problems.map((p) => (
                      <li key={p}>{t(`problem_${p}`)}</li>
                    ))}
                  </ul>
                )}
                <div className="flex flex-col sm:flex-row gap-2">
                  <button
                    type="button"
                    onClick={download}
                    disabled={problems.length > 0}
                    className={buttonClass('primary', 'md', 'w-full sm:flex-1 disabled:opacity-50 disabled:cursor-not-allowed')}
                    data-testid="editor-download"
                  >
                    {t('download', { file: fileName })}
                  </button>
                  <button
                    type="button"
                    onClick={() => void copy()}
                    disabled={problems.length > 0}
                    className={buttonClass('secondary', 'md', 'w-full sm:flex-1 disabled:opacity-50 disabled:cursor-not-allowed')}
                  >
                    {copied ? t('copied') : t('copy')}
                  </button>
                </div>
                <p className="text-xs text-[var(--ds-fg-muted)]">{t('afterDownload')}</p>
                <details className="text-sm">
                  <summary className="cursor-pointer text-[var(--ds-fg-muted)]">{t('showJson')}</summary>
                  <pre
                    className="mt-2 max-h-80 overflow-auto rounded bg-[var(--ds-bg-muted,rgba(127,127,127,0.08))] p-2 text-xs text-[var(--ds-fg)]"
                    data-testid="editor-json"
                  >
                    {json}
                  </pre>
                </details>
              </Section>
            </div>

            <div className="min-w-0 space-y-4">
              <section className="rounded border border-[var(--ds-border)]">
                <h2 className="px-4 pt-3 text-base font-semibold text-[var(--ds-fg)]">{t('preview')}</h2>
                <div className="relative flex h-[60vh] min-h-[360px] overflow-hidden p-2">
                  {pages.length > 0 && previewUrl ? (
                    <Viewer
                      iiifContent={previewUrl}
                      locale={locale}
                      theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
                      hidePanels={HIDDEN_VIEWER_TABS}
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center rounded border border-dashed border-[var(--ds-border)] p-4 text-center text-sm text-[var(--ds-fg-muted)]">
                      {t('previewEmpty')}
                    </div>
                  )}
                </div>
              </section>

              {pages.length > 0 && (
                <section className="space-y-3 rounded border border-[var(--ds-border)] p-4">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-base font-semibold text-[var(--ds-fg)]">{t('pages', { count: pages.length })}</h2>
                    <button type="button" onClick={clearPages} className={buttonClass('secondary', 'sm')}>
                      {t('clear')}
                    </button>
                  </div>
                  <p className="text-xs text-[var(--ds-fg-muted)]">{t('pagesNote')}</p>
                  <ol className="space-y-2" data-testid="editor-pages">
                    {pages.map((p, i) => (
                      <li key={p.key} className="flex gap-3 rounded border border-[var(--ds-border)] p-2">
                        {/* eslint-disable-next-line @next/next/no-img-element -- blob: の手元の画像 */}
                        <img src={p.previewUrl} alt="" className="h-20 w-16 shrink-0 rounded object-contain bg-black/5" />
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="w-8 shrink-0 text-xs tabular-nums text-[var(--ds-fg-muted)]">{i + 1}</span>
                            <input
                              type="text"
                              aria-label={t('pageLabel')}
                              className={smallInputClass}
                              value={p.label}
                              onChange={(e) => editPage(i, { label: e.target.value })}
                            />
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="w-8 shrink-0 text-xs text-[var(--ds-fg-muted)]">{t('pathShort')}</span>
                            <input
                              type="text"
                              aria-label={t('pagePath')}
                              className={`${smallInputClass} font-mono`}
                              value={p.path}
                              onChange={(e) => editPage(i, { path: e.target.value })}
                            />
                          </div>
                          <p className="pl-10 text-xs tabular-nums text-[var(--ds-fg-muted)]">
                            {p.width} × {p.height} px
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-col gap-1">
                          <button
                            type="button"
                            aria-label={t('moveUp')}
                            title={t('moveUp')}
                            disabled={i === 0}
                            onClick={() => setPages((ps) => move(ps, i, -1))}
                            className={buttonClass('secondary', 'sm', 'disabled:opacity-40')}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            aria-label={t('moveDown')}
                            title={t('moveDown')}
                            disabled={i === pages.length - 1}
                            onClick={() => setPages((ps) => move(ps, i, 1))}
                            className={buttonClass('secondary', 'sm', 'disabled:opacity-40')}
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            aria-label={t('remove')}
                            title={t('remove')}
                            onClick={() => removePage(i)}
                            className={buttonClass('secondary', 'sm')}
                          >
                            ×
                          </button>
                        </div>
                      </li>
                    ))}
                  </ol>
                </section>
              )}
            </div>
          </div>
        </div>
      </div>
    </CommonLayout>
  );
}
