// Custom IIIF primitive components to replace @samvera/clover-iiif/primitives
import React from 'react';
import { sanitizeAboutHtml } from '../../core';
import { LINK_CLASS } from '../panels/SafeHtml';
import { useLocale } from '../env';
import { labelIn } from '../../core/services/paintedModels';

export type IIIFLabel = string | string[] | Record<string, string | string[]>;

interface LabelProps {
  label: IIIFLabel;
  as?: string;
  className?: string;
}

export function Label({ label, as = 'span', className = '' }: LabelProps) {
  const locale = useLocale();
  if (!label) return null;
  const displayText = labelIn(label, locale);

  const props = { className };
  
  if (as === 'span') return <span {...props}>{displayText}</span>;
  if (as === 'div') return <div {...props}>{displayText}</div>;
  if (as === 'p') return <p {...props}>{displayText}</p>;
  if (as === 'h1') return <h1 {...props}>{displayText}</h1>;
  if (as === 'h2') return <h2 {...props}>{displayText}</h2>;
  if (as === 'h3') return <h3 {...props}>{displayText}</h3>;
  
  // Default to span
  return <span {...props}>{displayText}</span>;
}

interface SummaryProps {
  summary: IIIFLabel;
  className?: string;
}

export function Summary({ summary, className = '' }: SummaryProps) {
  const locale = useLocale();
  if (!summary) return null;
  const displayText = labelIn(summary, locale);

  return <div className={`${LINK_CLASS} ${className ?? ''}`} dangerouslySetInnerHTML={{ __html: sanitizeAboutHtml(displayText) }} />;
}

export interface MetadataItem {
  label: IIIFLabel;
  value: IIIFLabel;
}

interface MetadataProps {
  metadata: MetadataItem[];
  className?: string;
}

export function Metadata({ metadata, className = '' }: MetadataProps) {
  const locale = useLocale();
  if (!metadata || !Array.isArray(metadata)) return null;

  return (
    <div className={className}>
      {metadata.map((item, index) => {
        const labelText = labelIn(item.label, locale);
        const valueText = labelIn(item.value, locale);

        return (
          <div key={index} className="mb-2">
            <dt className="font-medium text-gray-700 dark:text-gray-300">
              {labelText}
            </dt>
            <dd className={`text-gray-900 dark:text-gray-100 ${LINK_CLASS}`} dangerouslySetInnerHTML={{ __html: sanitizeAboutHtml(valueText) }} />
          </div>
        );
      })}
    </div>
  );
}

interface SeeAlsoItem {
  id?: string;
  label?: IIIFLabel;
  type?: string;
  format?: string;
}

interface SeeAlsoProps {
  seeAlso: (SeeAlsoItem | string)[];
  className?: string;
}

export function Chip({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  if (!children) return null;
  return (
    <span className={`inline-flex items-center rounded-full bg-gray-100 dark:bg-gray-700 px-2 py-0.5 text-xs font-medium text-gray-700 dark:text-gray-200 ${className}`}>
      {children}
    </span>
  );
}

function TypeChip({ type }: { type?: string }) {
  if (!type) return null;
  return <Chip className="ml-2">{type}</Chip>;
}

export function SeeAlso({ seeAlso, className = '' }: SeeAlsoProps) {
  if (!seeAlso || !Array.isArray(seeAlso)) return null;

  return (
    <div className={className}>
      {seeAlso.map((item, index) => (
        <div key={index} className="mb-1 flex items-center flex-wrap">
          {typeof item === 'object' && item.id ? (
            <>
              <a
                href={item.id}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 dark:text-blue-400 hover:underline"
              >
                <Label label={item.label || item.id} />
              </a>
              {typeof item === 'object' && <TypeChip type={item.type} />}
            </>
          ) : (
            <>
              <Label label={typeof item === 'object' && item.label ? item.label : (item as string)} />
              {typeof item === 'object' && <TypeChip type={(item as SeeAlsoItem).type} />}
            </>
          )}
        </div>
      ))}
    </div>
  );
}

// Export types for compatibility
export interface PrimitivesExternalWebResource {
  id: string;
  label?: IIIFLabel;
  type?: string;
  format?: string;
  language?: string | string[];
}

interface ProviderAgent {
  id?: string;
  type?: string;
  label?: IIIFLabel;
  homepage?: PrimitivesExternalWebResource[];
  logo?: { id: string }[];
}

interface ProviderProps {
  provider: ProviderAgent[];
  className?: string;
}

export function Provider({ provider, className = '' }: ProviderProps) {
  if (!provider || !Array.isArray(provider)) return null;

  return (
    <div className={className}>
      {provider.map((agent, index) => (
        <div key={index} className="mb-2 flex items-center gap-2">
          {agent.logo?.[0]?.id && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={agent.logo[0].id}
              alt=""
              className="h-6 w-auto object-contain"
            />
          )}
          {agent.id ? (
            <a
              href={agent.id}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 dark:text-blue-400 hover:underline"
            >
              <Label label={agent.label || agent.id} />
            </a>
          ) : (
            <Label label={agent.label || ''} />
          )}
        </div>
      ))}
    </div>
  );
}

export const ResourceList = SeeAlso;

interface RequiredStatementProps {
  requiredStatement: MetadataItem;
  className?: string;
}

export function RequiredStatement({ requiredStatement, className = '' }: RequiredStatementProps) {
  if (!requiredStatement) return null;
  return (
    <div className={className}>
      <Metadata metadata={[requiredStatement]} />
    </div>
  );
}

interface ThumbnailItem {
  id: string;
  type?: string;
  format?: string;
  width?: number;
  height?: number;
  label?: IIIFLabel;
}

interface ThumbnailProps {
  thumbnail: ThumbnailItem[];
  className?: string;
}

export function Thumbnail({ thumbnail, className = '' }: ThumbnailProps) {
  if (!thumbnail || !Array.isArray(thumbnail) || thumbnail.length === 0) return null;
  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      {thumbnail.map((item, index) => {
        if (!item.id) return null;
        const isImage = !item.type || item.type === 'Image' || (item.format || '').startsWith('image/');
        if (!isImage) return null;
        return (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={index}
            src={item.id}
            alt=""
            className="max-h-32 w-auto rounded border border-gray-200 dark:border-gray-700 object-contain"
          />
        );
      })}
    </div>
  );
}

interface BehaviorProps {
  behavior: string[];
  className?: string;
}

export function Behavior({ behavior, className = '' }: BehaviorProps) {
  if (!behavior || !Array.isArray(behavior) || behavior.length === 0) return null;
  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      {behavior.map((item, index) => (
        <Chip key={index}>{item}</Chip>
      ))}
    </div>
  );
}

interface RightsProps {
  rights: string;
  className?: string;
}

export function Rights({ rights, className = '' }: RightsProps) {
  if (!rights) return null;

  const isUrl = /^https?:\/\//i.test(rights);

  if (!isUrl) {
    return <div className={className}>{rights}</div>;
  }

  return (
    <a
      href={rights}
      target="_blank"
      rel="noopener noreferrer"
      className={`text-blue-600 dark:text-blue-400 hover:underline ${className}`}
    >
      {rights}
    </a>
  );
}