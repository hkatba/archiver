"""initial schema

Revision ID: 0001
Revises: 
Create Date: 2026-11-19 00:02:52.270335

"""
from typing import Sequence, Union

from alembic import op
import pgvector.sqlalchemy
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '0001'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.create_table('users',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('email', sa.String(length=320), nullable=False),
    sa.Column('password_hash', sa.String(length=255), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('email')
    )
    op.create_table('api_tokens',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('name', sa.String(length=100), nullable=False),
    sa.Column('kind', sa.String(length=20), nullable=False),
    sa.Column('token_hash', sa.String(length=64), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('last_used_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('token_hash')
    )
    op.create_index(op.f('ix_api_tokens_user_id'), 'api_tokens', ['user_id'], unique=False)
    op.create_table('categories',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('parent_id', sa.UUID(), nullable=True),
    sa.Column('name', sa.String(length=120), nullable=False),
    sa.ForeignKeyConstraint(['parent_id'], ['categories.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('user_id', 'parent_id', 'name', postgresql_nulls_not_distinct=True)
    )
    op.create_index(op.f('ix_categories_user_id'), 'categories', ['user_id'], unique=False)
    op.create_table('collections',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('name', sa.String(length=120), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('icon', sa.String(length=40), nullable=True),
    sa.Column('rules', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_collections_user_id'), 'collections', ['user_id'], unique=False)
    op.create_table('search_history',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('query', sa.Text(), nullable=False),
    sa.Column('mode', sa.String(length=20), nullable=False),
    sa.Column('result_count', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_search_history_user_id'), 'search_history', ['user_id'], unique=False)
    op.create_table('tags',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('name', sa.String(length=60), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('user_id', 'name')
    )
    op.create_index(op.f('ix_tags_user_id'), 'tags', ['user_id'], unique=False)
    op.create_table('links',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('url', sa.Text(), nullable=False),
    sa.Column('normalized_url', sa.Text(), nullable=False),
    sa.Column('final_url', sa.Text(), nullable=True),
    sa.Column('canonical_url', sa.Text(), nullable=True),
    sa.Column('domain', sa.String(length=255), nullable=False),
    sa.Column('status', sa.Enum('PENDING', 'QUEUED', 'PROCESSING', 'ENRICHING', 'INDEXING', 'COMPLETED', 'FAILED', 'BLOCKED', 'NEEDS_REVIEW', name='link_status'), nullable=False),
    sa.Column('status_detail', sa.Text(), nullable=True),
    sa.Column('title', sa.Text(), nullable=True),
    sa.Column('name', sa.Text(), nullable=True),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('tldr', sa.Text(), nullable=True),
    sa.Column('content_type', sa.String(length=40), nullable=True),
    sa.Column('category_id', sa.UUID(), nullable=True),
    sa.Column('has_free_plan', sa.Boolean(), nullable=True),
    sa.Column('is_open_source', sa.Boolean(), nullable=True),
    sa.Column('favicon_key', sa.Text(), nullable=True),
    sa.Column('favicon_url', sa.Text(), nullable=True),
    sa.Column('image_url', sa.Text(), nullable=True),
    sa.Column('screenshot_key', sa.Text(), nullable=True),
    sa.Column('thumbnail_key', sa.Text(), nullable=True),
    sa.Column('is_favorite', sa.Boolean(), nullable=False),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.Column('overrides', postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'::jsonb"), nullable=False),
    sa.Column('availability', sa.String(length=20), nullable=False),
    sa.Column('http_status', sa.Integer(), nullable=True),
    sa.Column('last_checked_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('last_processed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('last_accessed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('duplicate_of_id', sa.UUID(), nullable=True),
    sa.Column('search_primary', sa.Text(), nullable=True),
    sa.Column('search_secondary', sa.Text(), nullable=True),
    sa.Column('search_tsv', postgresql.TSVECTOR(), sa.Computed("setweight(to_tsvector('english', coalesce(search_primary, '')), 'A') || setweight(to_tsvector('english', coalesce(search_secondary, '')), 'C')", persisted=True), nullable=True),
    sa.Column('embedding', pgvector.sqlalchemy.vector.VECTOR(dim=384), nullable=True),
    sa.Column('embedding_model', sa.String(length=120), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['category_id'], ['categories.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['duplicate_of_id'], ['links.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_links_category_id'), 'links', ['category_id'], unique=False)
    op.create_index('ix_links_embedding', 'links', ['embedding'], unique=False, postgresql_using='hnsw', postgresql_ops={'embedding': 'vector_cosine_ops'})
    op.create_index('ix_links_search_tsv', 'links', ['search_tsv'], unique=False, postgresql_using='gin')
    op.create_index('ix_links_user_created', 'links', ['user_id', 'created_at'], unique=False)
    op.create_index('ix_links_user_domain', 'links', ['user_id', 'domain'], unique=False)
    op.create_index('ix_links_user_status', 'links', ['user_id', 'status'], unique=False)
    op.create_index('uq_links_user_url', 'links', ['user_id', 'normalized_url'], unique=True, postgresql_where=sa.text('deleted_at IS NULL'))
    op.create_table('ai_enrichments',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('link_id', sa.UUID(), nullable=False),
    sa.Column('provider', sa.String(length=40), nullable=False),
    sa.Column('model', sa.String(length=120), nullable=False),
    sa.Column('prompt_version', sa.String(length=40), nullable=False),
    sa.Column('input_hash', sa.String(length=64), nullable=False),
    sa.Column('data', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('confidence', sa.Float(), nullable=True),
    sa.Column('tokens_in', sa.Integer(), nullable=False),
    sa.Column('tokens_out', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['link_id'], ['links.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_ai_enrichments_input_hash'), 'ai_enrichments', ['input_hash'], unique=False)
    op.create_index(op.f('ix_ai_enrichments_link_id'), 'ai_enrichments', ['link_id'], unique=False)
    op.create_table('availability_checks',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('link_id', sa.UUID(), nullable=False),
    sa.Column('ok', sa.Boolean(), nullable=False),
    sa.Column('http_status', sa.Integer(), nullable=True),
    sa.Column('final_url', sa.Text(), nullable=True),
    sa.Column('error', sa.Text(), nullable=True),
    sa.Column('checked_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['link_id'], ['links.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_availability_checks_link_id'), 'availability_checks', ['link_id'], unique=False)
    op.create_table('code_snippets',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('link_id', sa.UUID(), nullable=False),
    sa.Column('language', sa.String(length=40), nullable=True),
    sa.Column('code', sa.Text(), nullable=False),
    sa.Column('context', sa.Text(), nullable=True),
    sa.Column('position', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['link_id'], ['links.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_code_snippets_link_id'), 'code_snippets', ['link_id'], unique=False)
    op.create_table('collection_links',
    sa.Column('collection_id', sa.UUID(), nullable=False),
    sa.Column('link_id', sa.UUID(), nullable=False),
    sa.Column('added_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['collection_id'], ['collections.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['link_id'], ['links.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('collection_id', 'link_id')
    )
    op.create_index(op.f('ix_collection_links_link_id'), 'collection_links', ['link_id'], unique=False)
    op.create_table('extracted_contents',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('link_id', sa.UUID(), nullable=False),
    sa.Column('method', sa.String(length=20), nullable=False),
    sa.Column('partial', sa.Boolean(), nullable=False),
    sa.Column('http_status', sa.Integer(), nullable=True),
    sa.Column('final_url', sa.Text(), nullable=True),
    sa.Column('canonical_url', sa.Text(), nullable=True),
    sa.Column('title', sa.Text(), nullable=True),
    sa.Column('meta', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('markdown', sa.Text(), nullable=False),
    sa.Column('text_length', sa.Integer(), nullable=False),
    sa.Column('content_hash', sa.String(length=64), nullable=False),
    sa.Column('headings', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('tech_stack', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('github', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['link_id'], ['links.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_extracted_contents_link_id'), 'extracted_contents', ['link_id'], unique=False)
    op.create_table('ingestion_jobs',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('link_id', sa.UUID(), nullable=False),
    sa.Column('kind', sa.String(length=20), nullable=False),
    sa.Column('status', sa.Enum('PENDING', 'QUEUED', 'PROCESSING', 'ENRICHING', 'INDEXING', 'COMPLETED', 'FAILED', 'BLOCKED', 'NEEDS_REVIEW', name='link_status'), nullable=False),
    sa.Column('resume_from', sa.String(length=20), nullable=False),
    sa.Column('attempts', sa.Integer(), nullable=False),
    sa.Column('max_attempts', sa.Integer(), nullable=False),
    sa.Column('run_after', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('locked_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('locked_by', sa.String(length=80), nullable=True),
    sa.Column('last_error', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['link_id'], ['links.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_ingestion_jobs_link_id'), 'ingestion_jobs', ['link_id'], unique=False)
    op.create_index(op.f('ix_ingestion_jobs_user_id'), 'ingestion_jobs', ['user_id'], unique=False)
    op.create_index('ix_jobs_queue', 'ingestion_jobs', ['status', 'run_after'], unique=False)
    op.create_table('link_tags',
    sa.Column('link_id', sa.UUID(), nullable=False),
    sa.Column('tag_id', sa.UUID(), nullable=False),
    sa.Column('source', sa.String(length=10), nullable=False),
    sa.ForeignKeyConstraint(['link_id'], ['links.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['tag_id'], ['tags.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('link_id', 'tag_id')
    )
    op.create_index(op.f('ix_link_tags_tag_id'), 'link_tags', ['tag_id'], unique=False)
    op.create_table('processing_logs',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('link_id', sa.UUID(), nullable=False),
    sa.Column('job_id', sa.UUID(), nullable=True),
    sa.Column('stage', sa.String(length=20), nullable=False),
    sa.Column('level', sa.String(length=10), nullable=False),
    sa.Column('message', sa.Text(), nullable=False),
    sa.Column('data', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['job_id'], ['ingestion_jobs.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['link_id'], ['links.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_processing_logs_link_id'), 'processing_logs', ['link_id'], unique=False)
    # ### end Alembic commands ###


def downgrade() -> None:
    """Downgrade schema."""
    # ### commands auto generated by Alembic - please adjust! ###
    op.drop_index(op.f('ix_processing_logs_link_id'), table_name='processing_logs')
    op.drop_table('processing_logs')
    op.drop_index(op.f('ix_link_tags_tag_id'), table_name='link_tags')
    op.drop_table('link_tags')
    op.drop_index('ix_jobs_queue', table_name='ingestion_jobs')
    op.drop_index(op.f('ix_ingestion_jobs_user_id'), table_name='ingestion_jobs')
    op.drop_index(op.f('ix_ingestion_jobs_link_id'), table_name='ingestion_jobs')
    op.drop_table('ingestion_jobs')
    op.drop_index(op.f('ix_extracted_contents_link_id'), table_name='extracted_contents')
    op.drop_table('extracted_contents')
    op.drop_index(op.f('ix_collection_links_link_id'), table_name='collection_links')
    op.drop_table('collection_links')
    op.drop_index(op.f('ix_code_snippets_link_id'), table_name='code_snippets')
    op.drop_table('code_snippets')
    op.drop_index(op.f('ix_availability_checks_link_id'), table_name='availability_checks')
    op.drop_table('availability_checks')
    op.drop_index(op.f('ix_ai_enrichments_link_id'), table_name='ai_enrichments')
    op.drop_index(op.f('ix_ai_enrichments_input_hash'), table_name='ai_enrichments')
    op.drop_table('ai_enrichments')
    op.drop_index('uq_links_user_url', table_name='links', postgresql_where=sa.text('deleted_at IS NULL'))
    op.drop_index('ix_links_user_status', table_name='links')
    op.drop_index('ix_links_user_domain', table_name='links')
    op.drop_index('ix_links_user_created', table_name='links')
    op.drop_index('ix_links_search_tsv', table_name='links', postgresql_using='gin')
    op.drop_index('ix_links_embedding', table_name='links', postgresql_using='hnsw', postgresql_ops={'embedding': 'vector_cosine_ops'})
    op.drop_index(op.f('ix_links_category_id'), table_name='links')
    op.drop_table('links')
    op.drop_index(op.f('ix_tags_user_id'), table_name='tags')
    op.drop_table('tags')
    op.drop_index(op.f('ix_search_history_user_id'), table_name='search_history')
    op.drop_table('search_history')
    op.drop_index(op.f('ix_collections_user_id'), table_name='collections')
    op.drop_table('collections')
    op.drop_index(op.f('ix_categories_user_id'), table_name='categories')
    op.drop_table('categories')
    op.drop_index(op.f('ix_api_tokens_user_id'), table_name='api_tokens')
    op.drop_table('api_tokens')
    op.drop_table('users')
    sa.Enum(name='link_status').drop(op.get_bind(), checkfirst=True)
