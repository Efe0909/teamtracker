--
-- PostgreSQL database dump
--

\restrict ekiptakip

-- Dumped from database version 16.15
-- Dumped by pg_dump version 16.15

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: unaccent; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;


--
-- Name: EXTENSION unaccent; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION unaccent IS 'text search dictionary that removes accents';


--
-- Name: drop_chat(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.drop_chat() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin delete from chats where id = old.chat_id; return null; end $$;


--
-- Name: touch_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin new.updated_at = now(); return new; end $$;


--
-- Name: tr; Type: TEXT SEARCH CONFIGURATION; Schema: public; Owner: -
--

CREATE TEXT SEARCH CONFIGURATION public.tr (
    PARSER = pg_catalog."default" );

ALTER TEXT SEARCH CONFIGURATION public.tr
    ADD MAPPING FOR asciiword WITH simple;

ALTER TEXT SEARCH CONFIGURATION public.tr
    ADD MAPPING FOR word WITH public.unaccent, simple;

ALTER TEXT SEARCH CONFIGURATION public.tr
    ADD MAPPING FOR numword WITH simple;

ALTER TEXT SEARCH CONFIGURATION public.tr
    ADD MAPPING FOR email WITH simple;

ALTER TEXT SEARCH CONFIGURATION public.tr
    ADD MAPPING FOR url WITH simple;

ALTER TEXT SEARCH CONFIGURATION public.tr
    ADD MAPPING FOR host WITH simple;

ALTER TEXT SEARCH CONFIGURATION public.tr
    ADD MAPPING FOR sfloat WITH simple;

ALTER TEXT SEARCH CONFIGURATION public.tr
    ADD MAPPING FOR version WITH simple;

ALTER TEXT SEARCH CONFIGURATION public.tr
    ADD MAPPING FOR hword_numpart WITH simple;

ALTER TEXT SEARCH CONFIGURATION public.tr
    ADD MAPPING FOR hword_part WITH public.unaccent, simple;

ALTER TEXT SEARCH CONFIGURATION public.tr
    ADD MAPPING FOR hword_asciipart WITH simple;

ALTER TEXT SEARCH CONFIGURATION public.tr
    ADD MAPPING FOR numhword WITH simple;

ALTER TEXT SEARCH CONFIGURATION public.tr
    ADD MAPPING FOR asciihword WITH simple;

ALTER TEXT SEARCH CONFIGURATION public.tr
    ADD MAPPING FOR hword WITH public.unaccent, simple;

ALTER TEXT SEARCH CONFIGURATION public.tr
    ADD MAPPING FOR url_path WITH simple;

ALTER TEXT SEARCH CONFIGURATION public.tr
    ADD MAPPING FOR file WITH simple;

ALTER TEXT SEARCH CONFIGURATION public.tr
    ADD MAPPING FOR "float" WITH simple;

ALTER TEXT SEARCH CONFIGURATION public.tr
    ADD MAPPING FOR "int" WITH simple;

ALTER TEXT SEARCH CONFIGURATION public.tr
    ADD MAPPING FOR uint WITH simple;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: _sqlx_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public._sqlx_migrations (
    version bigint NOT NULL,
    description text NOT NULL,
    installed_on timestamp with time zone DEFAULT now() NOT NULL,
    success boolean NOT NULL,
    checksum bytea NOT NULL,
    execution_time bigint NOT NULL
);


--
-- Name: actions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.actions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    record_id uuid NOT NULL,
    title text NOT NULL,
    owner_id uuid,
    created_by uuid NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    due_date date,
    resolved_by uuid,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT actions_status_check CHECK ((status = ANY (ARRAY['open'::text, 'in_progress'::text, 'closed'::text, 'cancelled'::text])))
);


--
-- Name: activity; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.activity (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    chat_id uuid,
    actor_id uuid,
    verb text NOT NULL,
    subject_label text NOT NULL,
    target_label text,
    detail text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: attachment_tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attachment_tags (
    attachment_id uuid NOT NULL,
    tag_id uuid NOT NULL,
    added_by uuid,
    added_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attachments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    volume_id uuid NOT NULL,
    uploader_id uuid,
    mime text NOT NULL,
    byte_size bigint NOT NULL,
    checksum text,
    width integer,
    height integer,
    original_name text,
    storage_key text NOT NULL,
    thumb_key text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    deleted_by uuid,
    CONSTRAINT attachments_byte_size_check CHECK ((byte_size > 0)),
    CONSTRAINT attachments_mime_check CHECK ((mime = ANY (ARRAY['image/jpeg'::text, 'image/png'::text, 'image/webp'::text, 'image/gif'::text])))
);


--
-- Name: card_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.card_attachments (
    card_id uuid NOT NULL,
    attachment_id uuid NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL
);


--
-- Name: cards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cards (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    record_id uuid NOT NULL,
    card_type text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    chat_id uuid NOT NULL,
    author_id uuid,
    body text NOT NULL,
    reply_to_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    edited_at timestamp with time zone
);


--
-- Name: chat_feed; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.chat_feed AS
 SELECT 'message'::text AS kind,
    m.id,
    m.chat_id,
    m.created_at,
    m.author_id AS actor_id,
    NULL::text AS verb,
    NULL::text AS subject_label,
    NULL::text AS target_label,
    m.body,
    m.reply_to_id,
    m.edited_at
   FROM public.messages m
UNION ALL
 SELECT 'activity'::text AS kind,
    a.id,
    a.chat_id,
    a.created_at,
    a.actor_id,
    a.verb,
    a.subject_label,
    a.target_label,
    a.detail AS body,
    NULL::uuid AS reply_to_id,
    NULL::timestamp with time zone AS edited_at
   FROM public.activity a
  WHERE (a.chat_id IS NOT NULL);


--
-- Name: chats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chats (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: message_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.message_attachments (
    message_id uuid NOT NULL,
    attachment_id uuid NOT NULL
);


--
-- Name: nodes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.nodes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    parent_id uuid,
    name text NOT NULL,
    node_type text NOT NULL,
    description text,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT nodes_node_type_check CHECK ((node_type = ANY (ARRAY['cell'::text, 'machine'::text, 'task'::text, 'step'::text, 'operational'::text, 'generic'::text])))
);


--
-- Name: pillars; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pillars (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    description text,
    color text,
    team_id uuid NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: push_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.push_subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    endpoint text NOT NULL,
    p256dh text NOT NULL,
    auth text NOT NULL,
    user_agent text,
    last_ok_at timestamp with time zone,
    fail_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: record_participants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.record_participants (
    record_id uuid NOT NULL,
    user_id uuid NOT NULL,
    added_by uuid,
    added_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    unit_id uuid NOT NULL,
    pillar_id uuid,
    team_id uuid,
    chat_id uuid NOT NULL,
    kind text NOT NULL,
    title text NOT NULL,
    description text,
    status text DEFAULT 'open'::text NOT NULL,
    priority text DEFAULT 'medium'::text NOT NULL,
    owner_id uuid,
    created_by uuid NOT NULL,
    due_date date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    search_vector tsvector GENERATED ALWAYS AS (to_tsvector('public.tr'::regconfig, ((COALESCE(title, ''::text) || ' '::text) || COALESCE(description, ''::text)))) STORED,
    CONSTRAINT records_kind_check CHECK ((kind = ANY (ARRAY['issue'::text, 'task'::text]))),
    CONSTRAINT records_priority_check CHECK ((priority = ANY (ARRAY['critical'::text, 'high'::text, 'medium'::text, 'low'::text]))),
    CONSTRAINT records_status_check CHECK ((status = ANY (ARRAY['open'::text, 'in_progress'::text, 'pending'::text, 'closed'::text, 'cancelled'::text])))
);


--
-- Name: role_scopes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.role_scopes (
    role_id uuid NOT NULL,
    scope text NOT NULL
);


--
-- Name: roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: scopes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scopes (
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: security_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.security_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_type text NOT NULL,
    actor_id uuid,
    email text,
    ip inet,
    detail text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT security_events_event_type_check CHECK ((event_type = ANY (ARRAY['login'::text, 'login_denied'::text, 'logout'::text, 'permission_denied'::text, 'deactivation'::text, 'scope_granted'::text, 'scope_revoked'::text, 'role_granted'::text, 'role_revoked'::text, 'role_created'::text, 'role_deleted'::text, 'admin_granted'::text, 'admin_revoked'::text])))
);


--
-- Name: storage_volumes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.storage_volumes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    label text NOT NULL,
    kind text NOT NULL,
    mount_path text NOT NULL,
    media_prefix text DEFAULT ''::text NOT NULL,
    device text,
    fs_uuid text,
    fs_type text,
    is_active boolean DEFAULT false NOT NULL,
    is_online boolean DEFAULT false NOT NULL,
    checked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT storage_volumes_kind_check CHECK ((kind = ANY (ARRAY['local'::text, 'removable'::text, 'nas'::text])))
);


--
-- Name: tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tags (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: team_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.team_members (
    team_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text DEFAULT 'member'::text NOT NULL,
    added_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT team_members_role_check CHECK ((role = ANY (ARRAY['lead'::text, 'mentor'::text, 'member'::text])))
);


--
-- Name: teams; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teams (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    description text,
    chat_id uuid NOT NULL,
    color text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: team_nodes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.team_nodes (
    team_id uuid NOT NULL,
    node_id uuid NOT NULL,
    linked_by uuid,
    linked_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_node_scopes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_node_scopes (
    user_id uuid NOT NULL,
    node_id uuid NOT NULL,
    granted_by uuid,
    granted_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_pins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_pins (
    user_id uuid NOT NULL,
    slug text NOT NULL,
    pinned_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_roles (
    user_id uuid NOT NULL,
    role_id uuid NOT NULL,
    granted_by uuid,
    granted_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_scopes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_scopes (
    user_id uuid NOT NULL,
    scope text NOT NULL,
    granted_by uuid,
    granted_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    name text NOT NULL,
    color text,
    is_admin boolean DEFAULT false NOT NULL,
    google_sub text,
    is_active boolean DEFAULT true NOT NULL,
    notify_level text DEFAULT 'all'::text NOT NULL,
    last_login_at timestamp with time zone,
    last_seen_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT users_notify_level_check CHECK ((notify_level = ANY (ARRAY['all'::text, 'mentions'::text, 'none'::text])))
);


--
-- Name: _sqlx_migrations _sqlx_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public._sqlx_migrations
    ADD CONSTRAINT _sqlx_migrations_pkey PRIMARY KEY (version);


--
-- Name: actions actions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.actions
    ADD CONSTRAINT actions_pkey PRIMARY KEY (id);


--
-- Name: activity activity_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity
    ADD CONSTRAINT activity_pkey PRIMARY KEY (id);


--
-- Name: attachment_tags attachment_tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attachment_tags
    ADD CONSTRAINT attachment_tags_pkey PRIMARY KEY (attachment_id, tag_id);


--
-- Name: attachments attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attachments
    ADD CONSTRAINT attachments_pkey PRIMARY KEY (id);


--
-- Name: card_attachments card_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.card_attachments
    ADD CONSTRAINT card_attachments_pkey PRIMARY KEY (card_id, attachment_id);


--
-- Name: cards cards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cards
    ADD CONSTRAINT cards_pkey PRIMARY KEY (id);


--
-- Name: chats chats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chats
    ADD CONSTRAINT chats_pkey PRIMARY KEY (id);


--
-- Name: message_attachments message_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_attachments
    ADD CONSTRAINT message_attachments_pkey PRIMARY KEY (message_id, attachment_id);


--
-- Name: messages messages_chat_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_chat_id_id_key UNIQUE (chat_id, id);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);


--
-- Name: nodes nodes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nodes
    ADD CONSTRAINT nodes_pkey PRIMARY KEY (id);


--
-- Name: push_subscriptions push_subscriptions_endpoint_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_endpoint_key UNIQUE (endpoint);


--
-- Name: push_subscriptions push_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: record_participants record_participants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.record_participants
    ADD CONSTRAINT record_participants_pkey PRIMARY KEY (record_id, user_id);


--
-- Name: records records_chat_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.records
    ADD CONSTRAINT records_chat_id_key UNIQUE (chat_id);


--
-- Name: records records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.records
    ADD CONSTRAINT records_pkey PRIMARY KEY (id);


--
-- Name: role_scopes role_scopes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_scopes
    ADD CONSTRAINT role_scopes_pkey PRIMARY KEY (role_id, scope);


--
-- Name: roles roles_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_name_key UNIQUE (name);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);


--
-- Name: scopes scopes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scopes
    ADD CONSTRAINT scopes_pkey PRIMARY KEY (name);


--
-- Name: security_events security_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_events
    ADD CONSTRAINT security_events_pkey PRIMARY KEY (id);


--
-- Name: storage_volumes storage_volumes_label_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storage_volumes
    ADD CONSTRAINT storage_volumes_label_key UNIQUE (label);


--
-- Name: storage_volumes storage_volumes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storage_volumes
    ADD CONSTRAINT storage_volumes_pkey PRIMARY KEY (id);


--
-- Name: tags tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tags
    ADD CONSTRAINT tags_pkey PRIMARY KEY (id);


--
-- Name: tags tags_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tags
    ADD CONSTRAINT tags_slug_key UNIQUE (slug);


--
-- Name: team_members team_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_members
    ADD CONSTRAINT team_members_pkey PRIMARY KEY (team_id, user_id);


--
-- Name: team_nodes team_nodes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_nodes
    ADD CONSTRAINT team_nodes_pkey PRIMARY KEY (team_id, node_id);


--
-- Name: pillars pillars_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pillars
    ADD CONSTRAINT pillars_pkey PRIMARY KEY (id);


--
-- Name: pillars pillars_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pillars
    ADD CONSTRAINT pillars_name_key UNIQUE (name);


--
-- Name: pillars pillars_team_id_key; Type: CONSTRAINT; Schema: public; Owner: -
-- (bir takim en fazla bir pillar'in ozel takimi)
--

ALTER TABLE ONLY public.pillars
    ADD CONSTRAINT pillars_team_id_key UNIQUE (team_id);


--
-- Name: teams teams_chat_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_chat_id_key UNIQUE (chat_id);


--
-- Name: teams teams_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_name_key UNIQUE (name);


--
-- Name: teams teams_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_pkey PRIMARY KEY (id);


--
-- Name: user_node_scopes user_node_scopes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_node_scopes
    ADD CONSTRAINT user_node_scopes_pkey PRIMARY KEY (user_id, node_id);


--
-- Name: user_pins user_pins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_pins
    ADD CONSTRAINT user_pins_pkey PRIMARY KEY (user_id, slug);


--
-- Name: user_roles user_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_pkey PRIMARY KEY (user_id, role_id);


--
-- Name: user_scopes user_scopes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_scopes
    ADD CONSTRAINT user_scopes_pkey PRIMARY KEY (user_id, scope);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: actions_open_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX actions_open_idx ON public.actions USING btree (record_id) WHERE (status = ANY (ARRAY['open'::text, 'in_progress'::text]));


--
-- Name: actions_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX actions_owner_idx ON public.actions USING btree (owner_id) WHERE (status = ANY (ARRAY['open'::text, 'in_progress'::text]));


--
-- Name: actions_record_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX actions_record_idx ON public.actions USING btree (record_id);


--
-- Name: activity_chat_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX activity_chat_idx ON public.activity USING btree (chat_id, created_at) WHERE (chat_id IS NOT NULL);


--
-- Name: attachment_tags_tag_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX attachment_tags_tag_idx ON public.attachment_tags USING btree (tag_id);


--
-- Name: card_attachments_attachment_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX card_attachments_attachment_idx ON public.card_attachments USING btree (attachment_id);


--
-- Name: cards_record_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cards_record_idx ON public.cards USING btree (record_id, sort_order, created_at);


--
-- Name: message_attachments_attachment_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX message_attachments_attachment_idx ON public.message_attachments USING btree (attachment_id);


--
-- Name: messages_chat_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX messages_chat_idx ON public.messages USING btree (chat_id, created_at);


--
-- Name: nodes_parent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX nodes_parent_idx ON public.nodes USING btree (parent_id);


--
-- Name: push_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX push_user_idx ON public.push_subscriptions USING btree (user_id);


--
-- Name: record_participants_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX record_participants_user_idx ON public.record_participants USING btree (user_id);


--
-- Name: records_open_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX records_open_idx ON public.records USING btree (updated_at DESC) WHERE (status <> 'closed'::text);


--
-- Name: records_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX records_owner_idx ON public.records USING btree (owner_id);


--
-- Name: records_pillar_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX records_pillar_idx ON public.records USING btree (pillar_id) WHERE (pillar_id IS NOT NULL);


--
-- Name: records_search_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX records_search_idx ON public.records USING gin (search_vector);


--
-- Name: records_team_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX records_team_idx ON public.records USING btree (team_id) WHERE (team_id IS NOT NULL);


--
-- Name: records_unit_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX records_unit_idx ON public.records USING btree (unit_id);


--
-- Name: security_events_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX security_events_time_idx ON public.security_events USING btree (created_at DESC);


--
-- Name: security_events_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX security_events_type_idx ON public.security_events USING btree (event_type, created_at DESC);


--
-- Name: storage_volumes_single_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX storage_volumes_single_active ON public.storage_volumes USING btree (is_active) WHERE is_active;


--
-- Name: team_members_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX team_members_user_idx ON public.team_members USING btree (user_id);


--
-- Name: team_nodes_node_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX team_nodes_node_idx ON public.team_nodes USING btree (node_id);


--
-- Name: users_email_nocase_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX users_email_nocase_idx ON public.users USING btree (lower(email));


--
-- Name: users_last_seen_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX users_last_seen_idx ON public.users USING btree (last_seen_at DESC);


--
-- Name: records records_chat_gc; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER records_chat_gc AFTER DELETE ON public.records FOR EACH ROW EXECUTE FUNCTION public.drop_chat();


--
-- Name: records records_touch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER records_touch BEFORE UPDATE ON public.records FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: teams teams_chat_gc; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER teams_chat_gc AFTER DELETE ON public.teams FOR EACH ROW EXECUTE FUNCTION public.drop_chat();


--
-- Name: actions actions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.actions
    ADD CONSTRAINT actions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: actions actions_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.actions
    ADD CONSTRAINT actions_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: actions actions_record_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.actions
    ADD CONSTRAINT actions_record_id_fkey FOREIGN KEY (record_id) REFERENCES public.records(id) ON DELETE CASCADE;


--
-- Name: actions actions_resolved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.actions
    ADD CONSTRAINT actions_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: activity activity_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity
    ADD CONSTRAINT activity_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: activity activity_chat_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity
    ADD CONSTRAINT activity_chat_id_fkey FOREIGN KEY (chat_id) REFERENCES public.chats(id) ON DELETE SET NULL;


--
-- Name: attachment_tags attachment_tags_added_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attachment_tags
    ADD CONSTRAINT attachment_tags_added_by_fkey FOREIGN KEY (added_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: attachment_tags attachment_tags_attachment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attachment_tags
    ADD CONSTRAINT attachment_tags_attachment_id_fkey FOREIGN KEY (attachment_id) REFERENCES public.attachments(id) ON DELETE CASCADE;


--
-- Name: attachment_tags attachment_tags_tag_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attachment_tags
    ADD CONSTRAINT attachment_tags_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES public.tags(id) ON DELETE CASCADE;


--
-- Name: attachments attachments_deleted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attachments
    ADD CONSTRAINT attachments_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: attachments attachments_uploader_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attachments
    ADD CONSTRAINT attachments_uploader_id_fkey FOREIGN KEY (uploader_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: attachments attachments_volume_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attachments
    ADD CONSTRAINT attachments_volume_id_fkey FOREIGN KEY (volume_id) REFERENCES public.storage_volumes(id) ON DELETE RESTRICT;


--
-- Name: card_attachments card_attachments_attachment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.card_attachments
    ADD CONSTRAINT card_attachments_attachment_id_fkey FOREIGN KEY (attachment_id) REFERENCES public.attachments(id) ON DELETE CASCADE;


--
-- Name: card_attachments card_attachments_card_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.card_attachments
    ADD CONSTRAINT card_attachments_card_id_fkey FOREIGN KEY (card_id) REFERENCES public.cards(id) ON DELETE CASCADE;


--
-- Name: cards cards_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cards
    ADD CONSTRAINT cards_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: cards cards_record_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cards
    ADD CONSTRAINT cards_record_id_fkey FOREIGN KEY (record_id) REFERENCES public.records(id) ON DELETE CASCADE;


--
-- Name: message_attachments message_attachments_attachment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_attachments
    ADD CONSTRAINT message_attachments_attachment_id_fkey FOREIGN KEY (attachment_id) REFERENCES public.attachments(id) ON DELETE CASCADE;


--
-- Name: message_attachments message_attachments_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_attachments
    ADD CONSTRAINT message_attachments_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.messages(id) ON DELETE CASCADE;


--
-- Name: messages messages_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: messages messages_chat_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_chat_id_fkey FOREIGN KEY (chat_id) REFERENCES public.chats(id) ON DELETE CASCADE;


--
-- Name: messages messages_chat_id_reply_to_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_chat_id_reply_to_id_fkey FOREIGN KEY (chat_id, reply_to_id) REFERENCES public.messages(chat_id, id) ON DELETE SET NULL;


--
-- Name: nodes nodes_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nodes
    ADD CONSTRAINT nodes_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: nodes nodes_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nodes
    ADD CONSTRAINT nodes_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.nodes(id) ON DELETE CASCADE;


--
-- Name: push_subscriptions push_subscriptions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: record_participants record_participants_added_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.record_participants
    ADD CONSTRAINT record_participants_added_by_fkey FOREIGN KEY (added_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: record_participants record_participants_record_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.record_participants
    ADD CONSTRAINT record_participants_record_id_fkey FOREIGN KEY (record_id) REFERENCES public.records(id) ON DELETE CASCADE;


--
-- Name: record_participants record_participants_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.record_participants
    ADD CONSTRAINT record_participants_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: records records_chat_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.records
    ADD CONSTRAINT records_chat_id_fkey FOREIGN KEY (chat_id) REFERENCES public.chats(id) ON DELETE RESTRICT;


--
-- Name: records records_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.records
    ADD CONSTRAINT records_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: records records_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.records
    ADD CONSTRAINT records_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: records records_pillar_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.records
    ADD CONSTRAINT records_pillar_id_fkey FOREIGN KEY (pillar_id) REFERENCES public.pillars(id) ON DELETE SET NULL;


--
-- Name: records records_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.records
    ADD CONSTRAINT records_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE SET NULL;


--
-- Name: records records_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.records
    ADD CONSTRAINT records_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES public.nodes(id) ON DELETE CASCADE;


--
-- Name: role_scopes role_scopes_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_scopes
    ADD CONSTRAINT role_scopes_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;


--
-- Name: role_scopes role_scopes_scope_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_scopes
    ADD CONSTRAINT role_scopes_scope_fkey FOREIGN KEY (scope) REFERENCES public.scopes(name) ON DELETE RESTRICT;


--
-- Name: roles roles_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: security_events security_events_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_events
    ADD CONSTRAINT security_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: tags tags_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tags
    ADD CONSTRAINT tags_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: team_members team_members_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_members
    ADD CONSTRAINT team_members_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;


--
-- Name: team_members team_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_members
    ADD CONSTRAINT team_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: teams teams_chat_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_chat_id_fkey FOREIGN KEY (chat_id) REFERENCES public.chats(id) ON DELETE RESTRICT;


--
-- Name: team_nodes team_nodes_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_nodes
    ADD CONSTRAINT team_nodes_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;


--
-- Name: team_nodes team_nodes_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_nodes
    ADD CONSTRAINT team_nodes_node_id_fkey FOREIGN KEY (node_id) REFERENCES public.nodes(id) ON DELETE CASCADE;


--
-- Name: team_nodes team_nodes_linked_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_nodes
    ADD CONSTRAINT team_nodes_linked_by_fkey FOREIGN KEY (linked_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: pillars pillars_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pillars
    ADD CONSTRAINT pillars_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: pillars pillars_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
-- Pillar'in ozel takimi; pillar duruyorken takim silinemez.
--

ALTER TABLE ONLY public.pillars
    ADD CONSTRAINT pillars_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE RESTRICT;


--
-- Name: user_node_scopes user_node_scopes_granted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_node_scopes
    ADD CONSTRAINT user_node_scopes_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: user_node_scopes user_node_scopes_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_node_scopes
    ADD CONSTRAINT user_node_scopes_node_id_fkey FOREIGN KEY (node_id) REFERENCES public.nodes(id) ON DELETE CASCADE;


--
-- Name: user_node_scopes user_node_scopes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_node_scopes
    ADD CONSTRAINT user_node_scopes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_pins user_pins_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_pins
    ADD CONSTRAINT user_pins_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_roles user_roles_granted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: user_roles user_roles_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;


--
-- Name: user_roles user_roles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_scopes user_scopes_granted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_scopes
    ADD CONSTRAINT user_scopes_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: user_scopes user_scopes_scope_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_scopes
    ADD CONSTRAINT user_scopes_scope_fkey FOREIGN KEY (scope) REFERENCES public.scopes(name) ON DELETE RESTRICT;


--
-- Name: user_scopes user_scopes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_scopes
    ADD CONSTRAINT user_scopes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict ekiptakip

