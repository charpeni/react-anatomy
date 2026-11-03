import type { APIRoute, GetStaticPaths } from 'astro';
import { getCollection, type CollectionEntry } from 'astro:content';
import { documentMarkdown, documentPath } from '../lib/documentation.ts';

export const getStaticPaths: GetStaticPaths = async () => {
  return (await getCollection('docs')).map((entry) => ({
    params: { document: documentPath(entry) },
    props: { entry },
  }));
};

export const GET: APIRoute = ({ props }) => {
  return new Response(documentMarkdown(props.entry as CollectionEntry<'docs'>), {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  });
};
