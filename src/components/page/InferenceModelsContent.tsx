'use client';

import { useLocale, useTranslations } from 'next-intl';
import { INFERENCE_MODELS, type InferenceModel } from 'iiif-kasane';
import CommonLayout from '@/components/layout/Common';
import PageContainer from '@/components/layout/PageContainer';

// 推論タブのモデルの一覧。中身はモデルの定義（packages/iiif-viewer/src/react/inference/models/）から作るので、
// モデルを足せばここにも出る。

const mb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1e6)).toLocaleString()} MB`;

// 1 つのモデルが読むファイル（.onnx_data の重みも含める）
const fileRows = (m: InferenceModel) =>
  m.files.flatMap((f) => [
    { name: f.name, url: f.url, bytes: f.bytes },
    ...(f.data ? [{ name: f.data.path, url: f.data.url, bytes: f.data.bytes }] : []),
  ]);

const totalBytes = (m: InferenceModel) => fileRows(m).reduce((s, f) => s + f.bytes, 0);

function ModelCard({ model, locale }: { model: InferenceModel; locale: 'ja' | 'en' }) {
  const t = useTranslations('InferenceModels');
  const files = fileRows(model);
  const rows: [string, React.ReactNode][] = [
    [t('input'), model.input === 'points' ? t('inputPoints') : t('inputButton')],
    [t('size'), mb(totalBytes(model))],
    [t('imageSize'), t('imageSizeValue', { px: model.imageLongSide.toLocaleString() })],
    [t('engine'), model.engine === 'transformers' ? 'transformers.js' : 'ONNX Runtime Web'],
    [t('license'), model.license],
    [
      t('credit'),
      <a key="credit" href={model.homepage} target="_blank" rel="noopener noreferrer" className="underline">
        {model.credit[locale]}
      </a>,
    ],
  ];

  return (
    <li id={model.id} className="scroll-mt-20 rounded border border-[var(--ds-border)] p-4">
      <h2 className="text-lg font-semibold text-[var(--ds-fg)]">{model.name[locale]}</h2>
      <p className="mt-1 text-sm text-[var(--ds-fg-muted)]">{model.description[locale]}</p>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-[var(--ds-fg-muted)]">{k}</dt>
            <dd className="min-w-0 break-words text-[var(--ds-fg)]">{v}</dd>
          </div>
        ))}
      </dl>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-[var(--ds-fg-muted)]">{t('files', { count: files.length })}</summary>
        <ul className="mt-2 space-y-1">
          {files.map((f) => (
            <li key={f.url} className="flex items-baseline gap-2">
              <a href={f.url} className="min-w-0 flex-1 truncate font-mono text-xs underline" title={f.url}>
                {f.name}
              </a>
              <span className="shrink-0 text-xs tabular-nums text-[var(--ds-fg-muted)]">{mb(f.bytes)}</span>
            </li>
          ))}
        </ul>
      </details>
    </li>
  );
}

export default function InferenceModelsContent() {
  const t = useTranslations('InferenceModels');
  const locale = useLocale() === 'en' ? 'en' : 'ja';

  return (
    <CommonLayout>
      <PageContainer className="space-y-8">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-[var(--ds-fg)]">{t('title')}</h1>
          <p className="text-sm text-[var(--ds-fg-muted)]">{t('lead', { count: INFERENCE_MODELS.length })}</p>
          <p className="text-sm text-[var(--ds-fg-muted)]">{t('howTo')}</p>
          <p className="text-sm text-[var(--ds-fg-muted)]">{t('backend')}</p>
        </div>
        <ul className="grid gap-6 md:grid-cols-2">
          {INFERENCE_MODELS.map((m) => (
            <ModelCard key={m.id} model={m} locale={locale} />
          ))}
        </ul>
      </PageContainer>
    </CommonLayout>
  );
}
