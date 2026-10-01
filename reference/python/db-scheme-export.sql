--
-- PostgreSQL database dump
--

\restrict h1fuA9h4gSyzcrf0HEIsHPCHsjdsMZCtThlbr0xFarwfc1YoH7zwwmhJ5WwR3mb

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
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: unaccent; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;


--
-- Name: EXTENSION unaccent; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION unaccent IS 'text search dictionary that removes accents';


--
-- Name: tr; Type: TEXT SEARCH CONFIGURATION; Schema: public; Owner: ekiptakip
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


ALTER TEXT SEARCH CONFIGURATION public.tr OWNER TO ekiptakip;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: actions; Type: TABLE; Schema: public; Owner: ekiptakip
--

CREATE TABLE public.actions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    item_id uuid NOT NULL,
    title text NOT NULL,
    assignee_id uuid,
    status text DEFAULT 'open'::text NOT NULL,
    due_date date,
    created_by uuid NOT NULL,
    resolved_by uuid,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT actions_status_check CHECK ((status = ANY (ARRAY['open'::text, 'in_progress'::text, 'closed'::text, 'cancelled'::text])))
);


ALTER TABLE public.actions OWNER TO ekiptakip;

--
-- Name: attachment_tags; Type: TABLE; Schema: public; Owner: ekiptakip
--

CREATE TABLE public.attachment_tags (
    attachment_id uuid NOT NULL,
    tag_id uuid NOT NULL,
    added_by uuid,
    added_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.attachment_tags OWNER TO ekiptakip;

--
-- Name: attachments; Type: TABLE; Schema: public; Owner: ekiptakip
--

CREATE TABLE public.attachments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_type text NOT NULL,
    owner_id uuid NOT NULL,
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
    CONSTRAINT attachments_mime_check CHECK ((mime = ANY (ARRAY['image/jpeg'::text, 'image/png'::text, 'image/webp'::text, 'image/gif'::text]))),
    CONSTRAINT attachments_owner_type_check CHECK ((owner_type = ANY (ARRAY['event'::text, 'item'::text, 'node'::text, 'team'::text, 'card'::text])))
);


ALTER TABLE public.attachments OWNER TO ekiptakip;

--
-- Name: events; Type: TABLE; Schema: public; Owner: ekiptakip
--

CREATE TABLE public.events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subject_type text NOT NULL,
    subject_id uuid NOT NULL,
    event_type text NOT NULL,
    author_id uuid,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT events_event_type_check CHECK ((event_type = ANY (ARRAY['message'::text, 'system'::text]))),
    CONSTRAINT events_subject_type_check CHECK ((subject_type = ANY (ARRAY['item'::text, 'change_request'::text, 'team'::text, 'node'::text])))
);


ALTER TABLE public.events OWNER TO ekiptakip;

--
-- Name: item_cards; Type: TABLE; Schema: public; Owner: ekiptakip
--

CREATE TABLE public.item_cards (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    item_id uuid NOT NULL,
    card_type text NOT NULL,
    title text,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT item_cards_card_type_check CHECK ((card_type = ANY (ARRAY['media'::text, 'meeting'::text])))
);


ALTER TABLE public.item_cards OWNER TO ekiptakip;

--
-- Name: item_participants; Type: TABLE; Schema: public; Owner: ekiptakip
--

CREATE TABLE public.item_participants (
    item_id uuid NOT NULL,
    user_id uuid NOT NULL,
    added_by uuid,
    added_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.item_participants OWNER TO ekiptakip;

--
-- Name: items; Type: TABLE; Schema: public; Owner: ekiptakip
--

CREATE TABLE public.items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    node_id uuid NOT NULL,
    kind text NOT NULL,
    title text NOT NULL,
    description text,
    status text DEFAULT 'open'::text NOT NULL,
    priority text DEFAULT 'medium'::text NOT NULL,
    assignee_id uuid,
    created_by uuid NOT NULL,
    due_date date,
    dms text,
    escalated boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    search_vector tsvector GENERATED ALWAYS AS (to_tsvector('public.tr'::regconfig, ((COALESCE(title, ''::text) || ' '::text) || COALESCE(description, ''::text)))) STORED,
    team_id uuid,
    pillar_node_id uuid,
    CONSTRAINT items_kind_check CHECK ((kind = ANY (ARRAY['issue'::text, 'task'::text]))),
    CONSTRAINT items_priority_check CHECK ((priority = ANY (ARRAY['critical'::text, 'high'::text, 'medium'::text, 'low'::text]))),
    CONSTRAINT items_status_check CHECK ((status = ANY (ARRAY['open'::text, 'in_progress'::text, 'pending'::text, 'closed'::text])))
);


ALTER TABLE public.items OWNER TO ekiptakip;

--
-- Name: nodes; Type: TABLE; Schema: public; Owner: ekiptakip
--

CREATE TABLE public.nodes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    parent_id uuid,
    name text NOT NULL,
    node_type text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    pending_cr_id uuid,
    pending_delete boolean DEFAULT false NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    description text,
    is_active boolean DEFAULT true NOT NULL,
    CONSTRAINT nodes_node_type_check CHECK ((node_type = ANY (ARRAY['cell'::text, 'machine'::text, 'pillar'::text, 'team'::text, 'task'::text, 'step'::text, 'operational'::text, 'generic'::text])))
);


ALTER TABLE public.nodes OWNER TO ekiptakip;

--
-- Name: push_subscriptions; Type: TABLE; Schema: public; Owner: ekiptakip
--

CREATE TABLE public.push_subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    endpoint text NOT NULL,
    p256dh text NOT NULL,
    auth text NOT NULL,
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_ok_at timestamp with time zone,
    fail_count integer DEFAULT 0 NOT NULL
);


ALTER TABLE public.push_subscriptions OWNER TO ekiptakip;

--
-- Name: role_scopes; Type: TABLE; Schema: public; Owner: ekiptakip
--

CREATE TABLE public.role_scopes (
    role_id uuid NOT NULL,
    scope text NOT NULL
);


ALTER TABLE public.role_scopes OWNER TO ekiptakip;

--
-- Name: roles; Type: TABLE; Schema: public; Owner: ekiptakip
--

CREATE TABLE public.roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid
);


ALTER TABLE public.roles OWNER TO ekiptakip;

--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: ekiptakip
--

CREATE TABLE public.schema_migrations (
    name text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.schema_migrations OWNER TO ekiptakip;

--
-- Name: scopes; Type: TABLE; Schema: public; Owner: ekiptakip
--

CREATE TABLE public.scopes (
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.scopes OWNER TO ekiptakip;

--
-- Name: security_events; Type: TABLE; Schema: public; Owner: ekiptakip
--

CREATE TABLE public.security_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    event_type text NOT NULL,
    actor_id uuid,
    email text,
    ip inet,
    detail text,
    CONSTRAINT security_events_event_type_check CHECK ((event_type = ANY (ARRAY['login'::text, 'login_denied'::text, 'logout'::text, 'permission_denied'::text, 'deactivation'::text, 'scope_granted'::text, 'scope_revoked'::text, 'role_granted'::text, 'role_revoked'::text, 'role_created'::text, 'role_deleted'::text, 'admin_granted'::text, 'admin_revoked'::text])))
);


ALTER TABLE public.security_events OWNER TO ekiptakip;

--
-- Name: storage_volumes; Type: TABLE; Schema: public; Owner: ekiptakip
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
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT storage_volumes_kind_check CHECK ((kind = ANY (ARRAY['local'::text, 'removable'::text, 'nas'::text])))
);


ALTER TABLE public.storage_volumes OWNER TO ekiptakip;

--
-- Name: tags; Type: TABLE; Schema: public; Owner: ekiptakip
--

CREATE TABLE public.tags (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    color text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.tags OWNER TO ekiptakip;

--
-- Name: team_members; Type: TABLE; Schema: public; Owner: ekiptakip
--

CREATE TABLE public.team_members (
    team_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text DEFAULT 'member'::text NOT NULL,
    added_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT team_members_role_check CHECK ((role = ANY (ARRAY['lead'::text, 'mentor'::text, 'member'::text])))
);


ALTER TABLE public.team_members OWNER TO ekiptakip;

--
-- Name: teams; Type: TABLE; Schema: public; Owner: ekiptakip
--

CREATE TABLE public.teams (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    description text,
    node_id uuid,
    color text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.teams OWNER TO ekiptakip;

--
-- Name: user_node_scopes; Type: TABLE; Schema: public; Owner: ekiptakip
--

CREATE TABLE public.user_node_scopes (
    user_id uuid NOT NULL,
    node_id uuid NOT NULL,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    granted_by uuid
);


ALTER TABLE public.user_node_scopes OWNER TO ekiptakip;

--
-- Name: user_pins; Type: TABLE; Schema: public; Owner: ekiptakip
--

CREATE TABLE public.user_pins (
    user_id uuid NOT NULL,
    slug text NOT NULL,
    pinned_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.user_pins OWNER TO ekiptakip;

--
-- Name: user_roles; Type: TABLE; Schema: public; Owner: ekiptakip
--

CREATE TABLE public.user_roles (
    user_id uuid NOT NULL,
    role_id uuid NOT NULL,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    granted_by uuid
);


ALTER TABLE public.user_roles OWNER TO ekiptakip;

--
-- Name: user_scopes; Type: TABLE; Schema: public; Owner: ekiptakip
--

CREATE TABLE public.user_scopes (
    user_id uuid NOT NULL,
    scope text NOT NULL,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    granted_by uuid
);


ALTER TABLE public.user_scopes OWNER TO ekiptakip;

--
-- Name: users; Type: TABLE; Schema: public; Owner: ekiptakip
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    name text NOT NULL,
    color text,
    is_admin boolean DEFAULT false NOT NULL,
    is_editor boolean DEFAULT false NOT NULL,
    scope_node_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    google_sub text,
    is_active boolean DEFAULT true NOT NULL,
    last_login_at timestamp with time zone,
    last_seen_at timestamp with time zone
);


ALTER TABLE public.users OWNER TO ekiptakip;

--
-- Name: actions actions_pkey; Type: CONSTRAINT; Schema: public; Owner: ekiptakip
--

ALTER TABLE ONLY public.actions
    ADD CONSTRAINT actions_pkey PRIMARY KEY (id);


--
-- Name: attachment_tags attachment_tags_pkey; Type: CONSTRAINT; Schema: public; Owner: ekiptakip
--

ALTER TABLE ONLY public.attachment_tags
    ADD CONSTRAINT attachment_tags_pkey PRIMARY KEY (attachment_id, tag_id);


--
-- Name: attachments attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: ekiptakip
--

ALTER TABLE ONLY public.attachments
    ADD CONSTRAINT attachments_pkey PRIMARY KEY (id);


--
-- Name: attachments attachments_volume_id_storage_key_key; Type: CONSTRAINT; Schema: public; Owner: ekiptakip
--

ALTER TABLE ONLY public.attachments
    ADD CONSTRAINT attachments_volume_id_storage_key_key UNIQUE (volume_id, storage_key);


--
-- Name: events events_pkey; Type: CONSTRAINT; Schema: public; Owner: ekiptakip
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_pkey PRIMARY KEY (id);


--
-- Name: item_cards item_cards_pkey; Type: CONSTRAINT; Schema: public; Owner: ekiptakip
--

ALTER TABLE ONLY public.item_cards
    ADD CONSTRAINT item_cards_pkey PRIMARY KEY (id);


--
-- Name: item_participants item_participants_pkey; Type: CONSTRAINT; Schema: public; Owner: ekiptakip
--

ALTER TABLE ONLY public.item_participants
    ADD CONSTRAINT item_participants_pkey PRIMARY KEY (item_id, user_id);


--
-- Name: items items_pkey; Type: CONSTRAINT; Schema: public; Owner: ekiptakip
--

ALTER TABLE ONLY public.items
    ADD CONSTRAINT items_pkey PRIMARY KEY (id);


--
-- Name: nodes nodes_pkey; Type: CONSTRAINT; Schema: public; Owner: ekiptakip
--

ALTER TABLE ONLY public.nodes
    ADD CONSTRAINT nodes_pkey PRIMARY KEY (id);


--
-- Name: push_subscriptions push_subscriptions_endpoint_key; Type: CONSTRAINT; Schema: public; Owner: ekiptakip
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_endpoint_key UNIQUE (endpoint);


--
-- Name: push_subscriptions push_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: ekiptakip
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: role_scopes role_scopes_pkey; Type: CONSTRAINT; Schema: public; Owner: ekiptakip
--

ALTER TABLE ONLY public.role_scopes
    ADD CONSTRAINT role_scopes_pkey PRIMARY KEY (role_id, scope);


--
-- Name: roles roles_name_key; Type: CONSTRAINT; Schema: public; Owner: ekiptakip
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_name_key UNIQUE (name);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: ekiptakip
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: ekiptakip
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (name);


--
-- Name: scopes scopes_pkey; Type: CONSTRAINT; Schema: public; Owner: ekiptakip
--

ALTER TABLE ONLY public.scopes
    ADD CONSTRAINT scopes_pkey PRIMARY KEY (name);


--
-- Name: security_events security_events_pkey; Type: CONSTRAINT; Schema: public; Owner: ekiptakip
--

ALTER TABLE ONLY public.security_events
    ADD CONSTRAINT security_events_pkey PRIMARY KEY (id);


--
-- Name: storage_volumes storage_volumes_label_key; Type: CONSTRAINT; Schema: public; Owner: ekiptakip
--

ALTER TABLE ONLY public.storage_volumes
    ADD CONSTRAINT storage_volumes_label_key UNIQUE (label);


--
-- Name: storage_volumes storage_volumes_pkey; Type: CONSTRAINT; Schema: public; Owner: ekiptakip
--

ALTER TABLE ONLY public.storage_volumes
    ADD CONSTRAINT storage_volumes_pkey PRIMARY KEY (id);


--
-- Name: tags tags_pkey; Type: CONSTRAINT; Schema: public; Owner: ekiptakip
--

ALTER TABLE ONLY public.tags
    ADD CONSTRAINT tags_pkey PRIMARY KEY (id);


--
-- Name: tags tags_slug_key; Type: CONSTRAINT; Schema: public; Owner: ekiptakip
--

ALTER TABLE ONLY public.tags
    ADD CONSTRAINT tags_slug_key UNIQUE (slug);


--
-- Name: team_members team_members_pkey; Type: CONSTRAINT; Schema: public; Owner: ekiptakip
--

ALTER TABLE ONLY public.team_members
    ADD CONSTRAINT team_members_pkey PRIMARY KEY (team_id, user_id);


--
-- Name: teams teams_name_key; Type: CONSTRAINT; Schema: public; Owner: ekiptakip
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_name_key UNIQUE (name);


--
-- Name: teams teams_pkey; Type: CONSTRAINT; Schema: public; Owner: ekiptakip
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_pkey PRIMARY KEY (id);


--
-- Name: user_node_scopes user_node_scopes_pkey; Type: CONSTRAINT; Schema: public; Owner: ekiptakip
--

ALTER TABLE ONLY public.user_node_scopes
    ADD CONSTRAINT user_node_scopes_pkey PRIMARY KEY (user_id, node_id);


--
-- Name: user_pins user_pins_pkey; Type: CONSTRAINT; Schema: public; Owner: ekiptakip
--

ALTER TABLE ONLY public.user_pins
    ADD CONSTRAINT user_pins_pkey PRIMARY KEY (user_id, slug);


--
-- Name: user_roles user_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: ekiptakip
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_pkey PRIMARY KEY (user_id, role_id);


--
-- Name: user_scopes user_scopes_pkey; Type: CONSTRAINT; Schema: public; Owner: ekiptakip
--

ALTER TABLE ONLY public.user_scopes
    ADD CONSTRAINT user_scopes_pkey PRIMARY KEY (user_id, scope);


--
-- Name: users users_google_sub_key; Type: CONSTRAINT; Schema: public; Owner: ekiptakip
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_google_sub_key UNIQUE (google_sub);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: ekiptakip
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: actions_item_idx; Type: INDEX; Schema: public; Owner: ekiptakip
--

CREATE INDEX actions_item_idx ON public.actions USING btree (item_id);


--
-- Name: actions_open_idx; Type: INDEX; Schema: public; Owner: ekiptakip
--

CREATE INDEX actions_open_idx ON public.actions USING btree (item_id) WHERE (status = ANY (ARRAY['open'::text, 'in_progress'::text]));


--
-- Name: attachment_tags_tag_idx; Type: INDEX; Schema: public; Owner: ekiptakip
--

CREATE INDEX attachment_tags_tag_idx ON public.attachment_tags USING btree (tag_id);


--
-- Name: attachments_owner_idx; Type: INDEX; Schema: public; Owner: ekiptakip
--

CREATE INDEX attachments_owner_idx ON public.attachments USING btree (owner_type, owner_id, created_at);


--
-- Name: events_subject_idx; Type: INDEX; Schema: public; Owner: ekiptakip
--

CREATE INDEX events_subject_idx ON public.events USING btree (subject_type, subject_id, created_at);


--
-- Name: item_cards_item_idx; Type: INDEX; Schema: public; Owner: ekiptakip
--

CREATE INDEX item_cards_item_idx ON public.item_cards USING btree (item_id, sort_order, created_at);


--
-- Name: items_assignee_idx; Type: INDEX; Schema: public; Owner: ekiptakip
--

CREATE INDEX items_assignee_idx ON public.items USING btree (assignee_id);


--
-- Name: items_node_idx; Type: INDEX; Schema: public; Owner: ekiptakip
--

CREATE INDEX items_node_idx ON public.items USING btree (node_id);


--
-- Name: items_open_idx; Type: INDEX; Schema: public; Owner: ekiptakip
--

CREATE INDEX items_open_idx ON public.items USING btree (updated_at DESC) WHERE (status <> 'closed'::text);


--
-- Name: items_pillar_idx; Type: INDEX; Schema: public; Owner: ekiptakip
--

CREATE INDEX items_pillar_idx ON public.items USING btree (pillar_node_id) WHERE (pillar_node_id IS NOT NULL);


--
-- Name: items_search_idx; Type: INDEX; Schema: public; Owner: ekiptakip
--

CREATE INDEX items_search_idx ON public.items USING gin (search_vector);


--
-- Name: items_team_idx; Type: INDEX; Schema: public; Owner: ekiptakip
--

CREATE INDEX items_team_idx ON public.items USING btree (team_id);


--
-- Name: nodes_parent_idx; Type: INDEX; Schema: public; Owner: ekiptakip
--

CREATE INDEX nodes_parent_idx ON public.nodes USING btree (parent_id);


--
-- Name: push_user_idx; Type: INDEX; Schema: public; Owner: ekiptakip
--

CREATE INDEX push_user_idx ON public.push_subscriptions USING btree (user_id);


--
-- Name: security_events_time_idx; Type: INDEX; Schema: public; Owner: ekiptakip
--

CREATE INDEX security_events_time_idx ON public.security_events USING btree (created_at DESC);


--
-- Name: security_events_type_idx; Type: INDEX; Schema: public; Owner: ekiptakip
--

CREATE INDEX security_events_type_idx ON public.security_events USING btree (event_type, created_at DESC);


--
-- Name: storage_volumes_single_active; Type: INDEX; Schema: public; Owner: ekiptakip
--

CREATE UNIQUE INDEX storage_volumes_single_active ON public.storage_volumes USING btree (is_active) WHERE is_active;


--
-- Name: teams_node_uniq; Type: INDEX; Schema: public; Owner: ekiptakip
--

CREATE UNIQUE INDEX teams_node_uniq ON public.teams USING btree (node_id) WHERE (node_id IS NOT NULL);


--
-- Name: user_node_scopes_user_idx; Type: INDEX; Schema: public; Owner: ekiptakip
--

CREATE INDEX user_node_scopes_user_idx ON public.user_node_scopes USING btree (user_id);


--
-- Name: user_roles_user_idx; Type: INDEX; Schema: public; Owner: ekiptakip
--

CREATE INDEX user_roles_user_idx ON public.user_roles USING btree (user_id);


--
-- Name: users_email_nocase_idx; Type: INDEX; Schema: public; Owner: ekiptakip
--

CREATE UNIQUE INDEX users_email_nocase_idx ON public.users USING btree (lower(email));


--
-- Name: users_last_seen_idx; Type: INDEX; Schema: public; Owner: ekiptakip
--

CREATE INDEX users_last_seen_idx ON public.users USING btree (last_seen_at DESC);


--
-- Name: actions actions_assignee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: ekiptakip
--

ALTER TABLE ONLY public.actions
    ADD CONSTRAINT actions_assignee_id_fkey FOREIGN KEY (assignee_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: actions actions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: ekiptakip
--

ALTER TABLE ONLY public.actions
    ADD CONSTRAINT actions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: actions actions_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: ekiptakip
--

ALTER TABLE ONLY public.actions
    ADD CONSTRAINT actions_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(id) ON DELETE CASCADE;


--
-- Name: actions actions_resolved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: ekiptakip
--

ALTER TABLE ONLY public.actions
    ADD CONSTRAINT actions_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public.users(id);


--
-- Name: attachment_tags attachment_tags_added_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: ekiptakip
--

ALTER TABLE ONLY public.attachment_tags
    ADD CONSTRAINT attachment_tags_added_by_fkey FOREIGN KEY (added_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: attachment_tags attachment_tags_attachment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: ekiptakip
--

ALTER TABLE ONLY public.attachment_tags
    ADD CONSTRAINT attachment_tags_attachment_id_fkey FOREIGN KEY (attachment_id) REFERENCES public.attachments(id) ON DELETE CASCADE;


--
-- Name: attachment_tags attachment_tags_tag_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: ekiptakip
--

ALTER TABLE ONLY public.attachment_tags
    ADD CONSTRAINT attachment_tags_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES public.tags(id) ON DELETE CASCADE;


--
-- Name: attachments attachments_deleted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: ekiptakip
--

ALTER TABLE ONLY public.attachments
    ADD CONSTRAINT attachments_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: attachments attachments_uploader_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: ekiptakip
--

ALTER TABLE ONLY public.attachments
    ADD CONSTRAINT attachments_uploader_id_fkey FOREIGN KEY (uploader_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: attachments attachments_volume_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: ekiptakip
--

ALTER TABLE ONLY public.attachments
    ADD CONSTRAINT attachments_volume_id_fkey FOREIGN KEY (volume_id) REFERENCES public.storage_volumes(id) ON DELETE RESTRICT;


--
-- Name: events events_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: ekiptakip
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id);


--
-- Name: item_cards item_cards_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: ekiptakip
--

ALTER TABLE ONLY public.item_cards
    ADD CONSTRAINT item_cards_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: item_cards item_cards_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: ekiptakip
--

ALTER TABLE ONLY public.item_cards
    ADD CONSTRAINT item_cards_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(id) ON DELETE CASCADE;


--
-- Name: item_participants item_participants_added_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: ekiptakip
--

ALTER TABLE ONLY public.item_participants
    ADD CONSTRAINT item_participants_added_by_fkey FOREIGN KEY (added_by) REFERENCES public.users(id);


--
-- Name: item_participants item_participants_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: ekiptakip
--

ALTER TABLE ONLY public.item_participants
    ADD CONSTRAINT item_participants_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(id) ON DELETE CASCADE;


--
-- Name: item_participants item_participants_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: ekiptakip
--

ALTER TABLE ONLY public.item_participants
    ADD CONSTRAINT item_participants_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: items items_assignee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: ekiptakip
--

ALTER TABLE ONLY public.items
    ADD CONSTRAINT items_assignee_id_fkey FOREIGN KEY (assignee_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: items items_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: ekiptakip
--

ALTER TABLE ONLY public.items
    ADD CONSTRAINT items_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: items items_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: ekiptakip
--

ALTER TABLE ONLY public.items
    ADD CONSTRAINT items_node_id_fkey FOREIGN KEY (node_id) REFERENCES public.nodes(id) ON DELETE CASCADE;


--
-- Name: items items_pillar_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: ekiptakip
--

ALTER TABLE ONLY public.items
    ADD CONSTRAINT items_pillar_node_id_fkey FOREIGN KEY (pillar_node_id) REFERENCES public.nodes(id) ON DELETE SET NULL;


--
-- Name: items items_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: ekiptakip
--

ALTER TABLE ONLY public.items
    ADD CONSTRAINT items_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE SET NULL;


--
-- Name: nodes nodes_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: ekiptakip
--

ALTER TABLE ONLY public.nodes
    ADD CONSTRAINT nodes_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: nodes nodes_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: ekiptakip
--

ALTER TABLE ONLY public.nodes
    ADD CONSTRAINT nodes_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.nodes(id) ON DELETE CASCADE;


--
-- Name: push_subscriptions push_subscriptions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: ekiptakip
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: role_scopes role_scopes_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: ekiptakip
--

ALTER TABLE ONLY public.role_scopes
    ADD CONSTRAINT role_scopes_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;


--
-- Name: role_scopes role_scopes_scope_fkey; Type: FK CONSTRAINT; Schema: public; Owner: ekiptakip
--

ALTER TABLE ONLY public.role_scopes
    ADD CONSTRAINT role_scopes_scope_fkey FOREIGN KEY (scope) REFERENCES public.scopes(name) ON DELETE RESTRICT;


--
-- Name: roles roles_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: ekiptakip
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: security_events security_events_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: ekiptakip
--

ALTER TABLE ONLY public.security_events
    ADD CONSTRAINT security_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: tags tags_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: ekiptakip
--

ALTER TABLE ONLY public.tags
    ADD CONSTRAINT tags_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: team_members team_members_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: ekiptakip
--

ALTER TABLE ONLY public.team_members
    ADD CONSTRAINT team_members_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;


--
-- Name: team_members team_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: ekiptakip
--

ALTER TABLE ONLY public.team_members
    ADD CONSTRAINT team_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: teams teams_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: ekiptakip
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_node_id_fkey FOREIGN KEY (node_id) REFERENCES public.nodes(id) ON DELETE SET NULL;


--
-- Name: user_node_scopes user_node_scopes_granted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: ekiptakip
--

ALTER TABLE ONLY public.user_node_scopes
    ADD CONSTRAINT user_node_scopes_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: user_node_scopes user_node_scopes_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: ekiptakip
--

ALTER TABLE ONLY public.user_node_scopes
    ADD CONSTRAINT user_node_scopes_node_id_fkey FOREIGN KEY (node_id) REFERENCES public.nodes(id) ON DELETE CASCADE;


--
-- Name: user_node_scopes user_node_scopes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: ekiptakip
--

ALTER TABLE ONLY public.user_node_scopes
    ADD CONSTRAINT user_node_scopes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_pins user_pins_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: ekiptakip
--

ALTER TABLE ONLY public.user_pins
    ADD CONSTRAINT user_pins_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_roles user_roles_granted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: ekiptakip
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: user_roles user_roles_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: ekiptakip
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;


--
-- Name: user_roles user_roles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: ekiptakip
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_scopes user_scopes_granted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: ekiptakip
--

ALTER TABLE ONLY public.user_scopes
    ADD CONSTRAINT user_scopes_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: user_scopes user_scopes_scope_fk; Type: FK CONSTRAINT; Schema: public; Owner: ekiptakip
--

ALTER TABLE ONLY public.user_scopes
    ADD CONSTRAINT user_scopes_scope_fk FOREIGN KEY (scope) REFERENCES public.scopes(name) ON DELETE RESTRICT;


--
-- Name: user_scopes user_scopes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: ekiptakip
--

ALTER TABLE ONLY public.user_scopes
    ADD CONSTRAINT user_scopes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: users users_scope_fk; Type: FK CONSTRAINT; Schema: public; Owner: ekiptakip
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_scope_fk FOREIGN KEY (scope_node_id) REFERENCES public.nodes(id) ON DELETE SET NULL;


--
-- PostgreSQL database dump complete
--

\unrestrict h1fuA9h4gSyzcrf0HEIsHPCHsjdsMZCtThlbr0xFarwfc1YoH7zwwmhJ5WwR3mb

