import createNextIntlPlugin from 'next-intl/plugin';
import { generateRegistries, watchRegistries } from './scripts/gen-registries.mjs';

// 機能の一覧（右パネルのタブなど）を、置いてあるファイルから作る。開発中はファイルの追加も見張る
generateRegistries();
if (process.argv.includes('dev')) watchRegistries();

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

// GH Pages は project repo を `nakamura196.github.io/iiif-kasane/` で配信するため
// basePath / assetPrefix のサブパス対応が必須。Vercel 用 build (root 配信) と両立
// させるため、GH Actions の deploy-pages workflow で GITHUB_PAGES=true を立てたとき
// だけサブパスを付ける。
const isGhPages = process.env.GITHUB_PAGES === 'true';
const basePath = isGhPages ? '/iiif-kasane' : '';

/** @type {import('next').NextConfig} */
const nextConfig = {
  trailingSlash: true,
  output: 'export',
  basePath,
  assetPrefix: isGhPages ? `${basePath}/` : '',
  transpilePackages: ['@nakamura196/react-ui', 'iiif-kasane'],
  // Next.js は <Link href="/foo"> や next/router の URL に basePath を自動付与
  // するが、クエリ文字列に乗せて後で fetch するパス (manifest URL など) は
  // 対象外。クライアント側で参照できるよう public env として露出させる。
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
};

export default withNextIntl(nextConfig);
