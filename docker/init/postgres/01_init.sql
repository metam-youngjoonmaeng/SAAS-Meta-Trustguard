--
-- PostgreSQL database dump
--

\restrict Da37lSJRWnAhT90DhJGUuUnsCc6YGzvHOgaGEmUyVCFkCQ9qkez6QgabPGS6Nba

-- Dumped from database version 16.13
-- Dumped by pg_dump version 16.13

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

ALTER TABLE IF EXISTS ONLY public.qa_call_item_score DROP CONSTRAINT IF EXISTS "qa_evaluation_rows_ID_fkey";
ALTER TABLE IF EXISTS ONLY public.qa_call_transcript DROP CONSTRAINT IF EXISTS "qa_conversations_ID_fkey";
ALTER TABLE IF EXISTS ONLY public.qa_consumer_keywords DROP CONSTRAINT IF EXISTS "qa_consumer_keywords_ID_fkey";
ALTER TABLE IF EXISTS ONLY public.qa_consumer_eval_rows DROP CONSTRAINT IF EXISTS "qa_consumer_eval_rows_ID_fkey";
ALTER TABLE IF EXISTS ONLY public.qa_consumer_ai_categories DROP CONSTRAINT IF EXISTS "qa_consumer_ai_categories_ID_fkey";
ALTER TABLE IF EXISTS ONLY public.qa_call_item_evidence DROP CONSTRAINT IF EXISTS "qa_checklist_rows_ID_fkey";
ALTER TABLE IF EXISTS ONLY public.qa_call_pentagon_result DROP CONSTRAINT IF EXISTS "qa_analysis_report_ID_fkey";
DROP INDEX IF EXISTS public.idx_qa_consumer_keywords_id;
DROP INDEX IF EXISTS public.idx_qa_audit_resource;
DROP INDEX IF EXISTS public.idx_qa_audit_created;
DROP INDEX IF EXISTS public.idx_qa_audit_actor_time;
DROP INDEX IF EXISTS public.idx_qa_audit_action;
ALTER TABLE IF EXISTS ONLY public.qa_call_item_score DROP CONSTRAINT IF EXISTS qa_evaluation_rows_pkey;
ALTER TABLE IF EXISTS ONLY public.qa_call_transcript DROP CONSTRAINT IF EXISTS qa_conversations_pkey;
ALTER TABLE IF EXISTS ONLY public.qa_consumer_keywords DROP CONSTRAINT IF EXISTS qa_consumer_keywords_pkey;
ALTER TABLE IF EXISTS ONLY public.qa_consumer_eval_rows DROP CONSTRAINT IF EXISTS qa_consumer_eval_rows_pkey;
ALTER TABLE IF EXISTS ONLY public.qa_consumer_ai_categories DROP CONSTRAINT IF EXISTS qa_consumer_ai_categories_pkey;
ALTER TABLE IF EXISTS ONLY public.qa_call_item_evidence DROP CONSTRAINT IF EXISTS qa_checklist_rows_pkey;
ALTER TABLE IF EXISTS ONLY public.qa_calls DROP CONSTRAINT IF EXISTS qa_calls_pkey;
ALTER TABLE IF EXISTS ONLY public.qa_audit_logs DROP CONSTRAINT IF EXISTS qa_audit_logs_pkey;
ALTER TABLE IF EXISTS ONLY public.qa_call_pentagon_result DROP CONSTRAINT IF EXISTS qa_analysis_report_pkey;
ALTER TABLE IF EXISTS ONLY public.admin_users DROP CONSTRAINT IF EXISTS admin_users_pkey;
ALTER TABLE IF EXISTS ONLY public.admin_users DROP CONSTRAINT IF EXISTS admin_users_login_id_key;
ALTER TABLE IF EXISTS public.qa_consumer_keywords ALTER COLUMN keyword_id DROP DEFAULT;
ALTER TABLE IF EXISTS public.qa_audit_logs ALTER COLUMN audit_id DROP DEFAULT;
ALTER TABLE IF EXISTS public.admin_users ALTER COLUMN user_id DROP DEFAULT;
DROP TABLE IF EXISTS public.qa_evaluation_rows__sandbox_snapshot;
DROP TABLE IF EXISTS public.qa_call_item_score;
DROP TABLE IF EXISTS public.qa_conversations__sandbox_snapshot;
DROP TABLE IF EXISTS public.qa_call_transcript;
DROP SEQUENCE IF EXISTS public.qa_consumer_keywords_keyword_id_seq;
DROP TABLE IF EXISTS public.qa_consumer_keywords__sandbox_snapshot;
DROP TABLE IF EXISTS public.qa_consumer_keywords;
DROP TABLE IF EXISTS public.qa_consumer_eval_rows__sandbox_snapshot;
DROP TABLE IF EXISTS public.qa_consumer_eval_rows;
DROP TABLE IF EXISTS public.qa_consumer_ai_categories__sandbox_snapshot;
DROP TABLE IF EXISTS public.qa_consumer_ai_categories;
DROP TABLE IF EXISTS public.qa_checklist_rows__sandbox_snapshot;
DROP TABLE IF EXISTS public.qa_call_item_evidence;
DROP TABLE IF EXISTS public.qa_calls__sandbox_snapshot;
DROP TABLE IF EXISTS public.qa_calls;
DROP SEQUENCE IF EXISTS public.qa_audit_logs_audit_id_seq;
DROP TABLE IF EXISTS public.qa_audit_logs__sandbox_snapshot;
DROP TABLE IF EXISTS public.qa_audit_logs;
DROP TABLE IF EXISTS public.qa_analysis_report__sandbox_snapshot;
DROP TABLE IF EXISTS public.qa_call_pentagon_result;
DROP SEQUENCE IF EXISTS public.admin_users_user_id_seq;
DROP TABLE IF EXISTS public.admin_users;
SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: admin_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_users (
    user_id integer NOT NULL,
    login_id text NOT NULL,
    password_hash text NOT NULL,
    display_name text NOT NULL,
    role text DEFAULT 'admin'::text NOT NULL,
    is_active smallint DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: admin_users_user_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.admin_users_user_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: admin_users_user_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.admin_users_user_id_seq OWNED BY public.admin_users.user_id;


--
-- Name: qa_call_pentagon_result; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.qa_call_pentagon_result (
    "ID" text NOT NULL,
    item_type_no integer NOT NULL,
    item_type text NOT NULL,
    rating text,
    comment text NOT NULL,
    summary text
);


--
-- Name: qa_analysis_report__sandbox_snapshot; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.qa_analysis_report__sandbox_snapshot (
    "ID" text,
    item_type_no integer,
    item_type text,
    rating text,
    comment text,
    summary text
);


--
-- Name: qa_audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.qa_audit_logs (
    audit_id integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    actor_user_id integer,
    actor_login_id text NOT NULL,
    actor_display_name text,
    actor_role text,
    action text NOT NULL,
    resource_type text NOT NULL,
    resource_id text NOT NULL,
    http_method text,
    http_path text,
    client_ip text,
    user_agent text,
    detail_json text,
    success smallint DEFAULT 1 NOT NULL,
    error_message text
);


--
-- Name: qa_audit_logs__sandbox_snapshot; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.qa_audit_logs__sandbox_snapshot (
    audit_id integer,
    created_at timestamp with time zone,
    actor_user_id integer,
    actor_login_id text,
    actor_display_name text,
    actor_role text,
    action text,
    resource_type text,
    resource_id text,
    http_method text,
    http_path text,
    client_ip text,
    user_agent text,
    detail_json text,
    success smallint,
    error_message text
);


--
-- Name: qa_audit_logs_audit_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.qa_audit_logs_audit_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: qa_audit_logs_audit_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.qa_audit_logs_audit_id_seq OWNED BY public.qa_audit_logs.audit_id;


--
-- Name: qa_calls; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.qa_calls (
    "ID" text NOT NULL,
    "CALL_SEQ" text NOT NULL,
    "CDATE" text NOT NULL,
    "UID" text NOT NULL,
    "AI_SCORE" double precision NOT NULL,
    "TOTAL_SCORE" double precision NOT NULL,
    department text DEFAULT '컬렉션관리부'::text NOT NULL,
    role text DEFAULT 'PDS1'::text NOT NULL,
    ai_analysis_target text,
    ai_analysis_reason text,
    voc_code text,
    promotion_code text,
    is_sandbox boolean DEFAULT false NOT NULL,
    CONSTRAINT qa_calls_ai_target_chk CHECK (((ai_analysis_target IS NULL) OR (ai_analysis_target = ANY (ARRAY['O'::text, 'X'::text])))),
    CONSTRAINT qa_calls_department_chk CHECK ((department = ANY (ARRAY['컬렉션관리부'::text, '소비자보호부'::text]))),
    CONSTRAINT qa_calls_role_chk CHECK ((role = ANY (ARRAY['PDS1'::text, 'PDS2'::text, 'PDS3'::text, '수동대인'::text, '인바운드'::text, '전체'::text])))
);

CREATE INDEX IF NOT EXISTS idx_qa_calls_is_sandbox ON public.qa_calls (is_sandbox) WHERE is_sandbox = true;


--
-- Name: qa_calls__sandbox_snapshot; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.qa_calls__sandbox_snapshot (
    "ID" text,
    "CALL_SEQ" text,
    "CDATE" text,
    "UID" text,
    "AI_SCORE" double precision,
    "TOTAL_SCORE" double precision,
    department text,
    role text,
    ai_analysis_target text,
    ai_analysis_reason text,
    voc_code text,
    promotion_code text
);


--
-- Name: qa_call_item_evidence; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.qa_call_item_evidence (
    "ID" text NOT NULL,
    order_no integer NOT NULL,
    category text NOT NULL,
    item text NOT NULL,
    agent_utterance text NOT NULL,
    validation_time text NOT NULL
);


--
-- Name: qa_checklist_rows__sandbox_snapshot; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.qa_checklist_rows__sandbox_snapshot (
    "ID" text,
    order_no integer,
    category text,
    item text,
    agent_utterance text,
    validation_time text
);


--
-- Name: qa_consumer_ai_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.qa_consumer_ai_categories (
    "ID" text NOT NULL,
    category_no integer NOT NULL,
    major_category text NOT NULL,
    sub_category text NOT NULL,
    score numeric(5,2) NOT NULL,
    CONSTRAINT qa_consumer_ai_categories_score_chk CHECK (((score >= (0)::numeric) AND (score <= (100)::numeric)))
);


--
-- Name: qa_consumer_ai_categories__sandbox_snapshot; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.qa_consumer_ai_categories__sandbox_snapshot (
    "ID" text,
    category_no integer,
    major_category text,
    sub_category text,
    score numeric(5,2)
);


--
-- Name: qa_consumer_eval_rows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.qa_consumer_eval_rows (
    "ID" text NOT NULL,
    item_no integer NOT NULL,
    major_category text NOT NULL,
    sub_no integer NOT NULL,
    criterion text NOT NULL,
    item_text text NOT NULL,
    yn text NOT NULL,
    detail_text text,
    evidence_line_no integer,
    evidence_text text,
    CONSTRAINT qa_consumer_eval_rows_yn_chk CHECK ((yn = ANY (ARRAY['Y'::text, 'N'::text])))
);


--
-- Name: qa_consumer_eval_rows__sandbox_snapshot; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.qa_consumer_eval_rows__sandbox_snapshot (
    "ID" text,
    item_no integer,
    major_category text,
    sub_no integer,
    criterion text,
    item_text text,
    yn text,
    detail_text text,
    evidence_line_no integer,
    evidence_text text
);


--
-- Name: qa_consumer_keywords; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.qa_consumer_keywords (
    keyword_id integer NOT NULL,
    "ID" text NOT NULL,
    level text NOT NULL,
    major_category text NOT NULL,
    sub_category text NOT NULL,
    keyword text NOT NULL,
    line_no integer,
    line_text text
);


--
-- Name: qa_consumer_keywords__sandbox_snapshot; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.qa_consumer_keywords__sandbox_snapshot (
    keyword_id integer,
    "ID" text,
    level text,
    major_category text,
    sub_category text,
    keyword text,
    line_no integer,
    line_text text
);


--
-- Name: qa_consumer_keywords_keyword_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.qa_consumer_keywords_keyword_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: qa_consumer_keywords_keyword_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.qa_consumer_keywords_keyword_id_seq OWNED BY public.qa_consumer_keywords.keyword_id;


--
-- Name: qa_call_transcript; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.qa_call_transcript (
    "ID" text NOT NULL,
    turn_no integer NOT NULL,
    speaker text NOT NULL,
    text text NOT NULL
);


--
-- Name: qa_conversations__sandbox_snapshot; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.qa_conversations__sandbox_snapshot (
    "ID" text,
    turn_no integer,
    speaker text,
    text text
);


--
-- Name: qa_call_item_score; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.qa_call_item_score (
    "ID" text NOT NULL,
    order_no integer NOT NULL,
    category text NOT NULL,
    item text NOT NULL,
    reason_text text NOT NULL,
    ai_eval double precision NOT NULL,
    manual_eval double precision NOT NULL
);


--
-- Name: qa_evaluation_rows__sandbox_snapshot; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.qa_evaluation_rows__sandbox_snapshot (
    "ID" text,
    order_no integer,
    category text,
    item text,
    reason_text text,
    ai_eval double precision,
    manual_eval double precision
);


--
-- Name: admin_users user_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_users ALTER COLUMN user_id SET DEFAULT nextval('public.admin_users_user_id_seq'::regclass);


--
-- Name: qa_audit_logs audit_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qa_audit_logs ALTER COLUMN audit_id SET DEFAULT nextval('public.qa_audit_logs_audit_id_seq'::regclass);


--
-- Name: qa_consumer_keywords keyword_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qa_consumer_keywords ALTER COLUMN keyword_id SET DEFAULT nextval('public.qa_consumer_keywords_keyword_id_seq'::regclass);


--
-- Data for Name: admin_users; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.admin_users (user_id, login_id, password_hash, display_name, role, is_active, created_at, updated_at) FROM stdin;
1	admin1	03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4	관리자	admin	1	2026-05-04 06:30:00.145504+00	2026-05-04 06:30:00.145504+00
8	test1	03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4	테스트(샌드박스)	admin	1	2026-05-06 01:28:07.753386+00	2026-05-06 01:28:07.753386+00
\.


--
-- Data for Name: qa_call_pentagon_result; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.qa_call_pentagon_result ("ID", item_type_no, item_type, rating, comment, summary) FROM stdin;
QA-20260308-0001	1	오프닝 및 목적 안내	보통	오프닝 인사와 소속·성명 고지는 이루어졌으나 안내 도입부에서 회원 호명이 약함	\N
QA-20260308-0001	2	설명 명확성	보통	미납 금액과 일정 안내는 이루어졌으나 분할 옵션 등 추가 정보 제공이 부족함	\N
QA-20260308-0001	3	준수·고지 품질	보통	본인 확인은 정상 수행되었으나 사후 안내 멘트가 간략함	\N
QA-20260308-0001	4	대화·경청 품질	주의	고객 발화에 대한 공감 표현이 제한적이고 질문 전환이 빠른 편	\N
QA-20260308-0001	5	발화 안정성	보통	전반적으로 안정적이나 일부 구간에서 속도가 빨라짐	\N
QA-20260308-0001	99	summary	\N	기본 절차는 준수되었으나 공감·대안 제시·사후 안내에서 보강 여지가 있음	기본 절차는 준수되었으나 공감·대안 제시·사후 안내에서 보강 여지가 있음
QA-20260308-0002	1	오프닝 및 목적 안내	우수	오프닝과 통화 목적 안내가 명확함	\N
QA-20260308-0002	2	설명 명확성	우수	누적 연체금과 분할 옵션을 명확히 안내하고 동의를 받음	\N
QA-20260308-0002	3	준수·고지 품질	우수	약속 미이행 시 후속 연락 가능성을 고지하고 시스템 등록을 안내함	\N
QA-20260308-0002	4	대화·경청 품질	우수	고객의 자금 사정에 공감하고 분할 제안으로 자연스럽게 연결함	\N
QA-20260308-0002	5	발화 안정성	보통	차분한 어조가 유지되나 일부 표현이 다소 사무적임	\N
QA-20260308-0002	99	summary	\N	분할 안내와 동의 확보까지 자연스럽게 이어졌고 사후 등록 안내까지 포함되어 전반적으로 양호함	분할 안내와 동의 확보까지 자연스럽게 이어졌고 사후 등록 안내까지 포함되어 전반적으로 양호함
QA-20260308-0003	1	오프닝 및 목적 안내	우수	소속·성명·통화 목적이 모두 명확하게 전달됨	\N
QA-20260308-0003	2	설명 명확성	우수	분할 횟수·금액·첫 회 입금일까지 구체적으로 합의됨	\N
QA-20260308-0003	3	준수·고지 품질	우수	약정 내용 재확인과 시스템 등록·안내 문자 발송이 모두 포함됨	\N
QA-20260308-0003	4	대화·경청 품질	우수	고객의 사업 어려움에 공감하고 가능한 금액을 함께 정리함	\N
QA-20260308-0003	5	발화 안정성	우수	안정된 속도와 톤이 일관되게 유지됨	\N
QA-20260308-0003	99	summary	\N	분할 합의 과정과 약정 등록까지 모범적으로 이루어진 콜로 평가됨	분할 합의 과정과 약정 등록까지 모범적으로 이루어진 콜로 평가됨
QA-20260308-0004	1	오프닝 및 목적 안내	주의	소속만 언급되고 성명 고지가 누락됨	\N
QA-20260308-0004	2	설명 명확성	주의	미납 금액과 일정에 대한 구체적 정보 제공이 부족함	\N
QA-20260308-0004	3	준수·고지 품질	주의	본인 확인 절차가 약하고 종료 시 사후 안내가 누락됨	\N
QA-20260308-0004	4	대화·경청 품질	실패	고객의 바쁜 상황에 대한 공감 표현이 거의 없음	\N
QA-20260308-0004	5	발화 안정성	주의	다소 빠른 속도와 단조로운 어조로 응대됨	\N
QA-20260308-0004	99	summary	\N	오프닝·공감·대안 제시·사후 안내 전반에서 보강이 필요한 콜	오프닝·공감·대안 제시·사후 안내 전반에서 보강이 필요한 콜
QA-20260308-0005	1	오프닝 및 목적 안내	우수	고객센터 소속과 성명을 명확히 안내하고 문의 의도를 확인함	\N
QA-20260308-0005	2	설명 명확성	우수	추가 연체이자 부과 조건과 가상계좌 처리 절차를 정확히 안내함	\N
QA-20260308-0005	3	준수·고지 품질	보통	처리 후 알림 문자 안내가 포함되었으나 종료 인사가 다소 짧음	\N
QA-20260308-0005	4	대화·경청 품질	우수	고객 질문에 적극 응대하고 즉시 가상계좌 안내로 연결함	\N
QA-20260308-0005	5	발화 안정성	우수	차분한 속도와 안정된 음성으로 응대함	\N
QA-20260308-0005	99	summary	\N	인바운드 응대로서 빠른 정보 제공과 가상계좌 안내가 자연스럽게 이루어진 양호한 콜	인바운드 응대로서 빠른 정보 제공과 가상계좌 안내가 자연스럽게 이루어진 양호한 콜
\.


--
-- Data for Name: qa_analysis_report__sandbox_snapshot; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.qa_analysis_report__sandbox_snapshot ("ID", item_type_no, item_type, rating, comment, summary) FROM stdin;
QA-20260308-0001	1	오프닝 및 목적 안내	보통	오프닝 인사와 소속·성명 고지는 이루어졌으나 안내 도입부에서 회원 호명이 약함	\N
QA-20260308-0001	2	설명 명확성	보통	미납 금액과 일정 안내는 이루어졌으나 분할 옵션 등 추가 정보 제공이 부족함	\N
QA-20260308-0001	3	준수·고지 품질	보통	본인 확인은 정상 수행되었으나 사후 안내 멘트가 간략함	\N
QA-20260308-0001	4	대화·경청 품질	주의	고객 발화에 대한 공감 표현이 제한적이고 질문 전환이 빠른 편	\N
QA-20260308-0001	5	발화 안정성	보통	전반적으로 안정적이나 일부 구간에서 속도가 빨라짐	\N
QA-20260308-0001	99	summary	\N	기본 절차는 준수되었으나 공감·대안 제시·사후 안내에서 보강 여지가 있음	기본 절차는 준수되었으나 공감·대안 제시·사후 안내에서 보강 여지가 있음
QA-20260308-0002	1	오프닝 및 목적 안내	우수	오프닝과 통화 목적 안내가 명확함	\N
QA-20260308-0002	2	설명 명확성	우수	누적 연체금과 분할 옵션을 명확히 안내하고 동의를 받음	\N
QA-20260308-0002	3	준수·고지 품질	우수	약속 미이행 시 후속 연락 가능성을 고지하고 시스템 등록을 안내함	\N
QA-20260308-0002	4	대화·경청 품질	우수	고객의 자금 사정에 공감하고 분할 제안으로 자연스럽게 연결함	\N
QA-20260308-0002	5	발화 안정성	보통	차분한 어조가 유지되나 일부 표현이 다소 사무적임	\N
QA-20260308-0002	99	summary	\N	분할 안내와 동의 확보까지 자연스럽게 이어졌고 사후 등록 안내까지 포함되어 전반적으로 양호함	분할 안내와 동의 확보까지 자연스럽게 이어졌고 사후 등록 안내까지 포함되어 전반적으로 양호함
QA-20260308-0003	1	오프닝 및 목적 안내	우수	소속·성명·통화 목적이 모두 명확하게 전달됨	\N
QA-20260308-0003	2	설명 명확성	우수	분할 횟수·금액·첫 회 입금일까지 구체적으로 합의됨	\N
QA-20260308-0003	3	준수·고지 품질	우수	약정 내용 재확인과 시스템 등록·안내 문자 발송이 모두 포함됨	\N
QA-20260308-0003	4	대화·경청 품질	우수	고객의 사업 어려움에 공감하고 가능한 금액을 함께 정리함	\N
QA-20260308-0003	5	발화 안정성	우수	안정된 속도와 톤이 일관되게 유지됨	\N
QA-20260308-0003	99	summary	\N	분할 합의 과정과 약정 등록까지 모범적으로 이루어진 콜로 평가됨	분할 합의 과정과 약정 등록까지 모범적으로 이루어진 콜로 평가됨
QA-20260308-0004	1	오프닝 및 목적 안내	주의	소속만 언급되고 성명 고지가 누락됨	\N
QA-20260308-0004	2	설명 명확성	주의	미납 금액과 일정에 대한 구체적 정보 제공이 부족함	\N
QA-20260308-0004	3	준수·고지 품질	주의	본인 확인 절차가 약하고 종료 시 사후 안내가 누락됨	\N
QA-20260308-0004	4	대화·경청 품질	실패	고객의 바쁜 상황에 대한 공감 표현이 거의 없음	\N
QA-20260308-0004	5	발화 안정성	주의	다소 빠른 속도와 단조로운 어조로 응대됨	\N
QA-20260308-0004	99	summary	\N	오프닝·공감·대안 제시·사후 안내 전반에서 보강이 필요한 콜	오프닝·공감·대안 제시·사후 안내 전반에서 보강이 필요한 콜
QA-20260308-0005	1	오프닝 및 목적 안내	우수	고객센터 소속과 성명을 명확히 안내하고 문의 의도를 확인함	\N
QA-20260308-0005	2	설명 명확성	우수	추가 연체이자 부과 조건과 가상계좌 처리 절차를 정확히 안내함	\N
QA-20260308-0005	3	준수·고지 품질	보통	처리 후 알림 문자 안내가 포함되었으나 종료 인사가 다소 짧음	\N
QA-20260308-0005	4	대화·경청 품질	우수	고객 질문에 적극 응대하고 즉시 가상계좌 안내로 연결함	\N
QA-20260308-0005	5	발화 안정성	우수	차분한 속도와 안정된 음성으로 응대함	\N
QA-20260308-0005	99	summary	\N	인바운드 응대로서 빠른 정보 제공과 가상계좌 안내가 자연스럽게 이루어진 양호한 콜	인바운드 응대로서 빠른 정보 제공과 가상계좌 안내가 자연스럽게 이루어진 양호한 콜
\.


--
-- Data for Name: qa_audit_logs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.qa_audit_logs (audit_id, created_at, actor_user_id, actor_login_id, actor_display_name, actor_role, action, resource_type, resource_id, http_method, http_path, client_ip, user_agent, detail_json, success, error_message) FROM stdin;
1	2026-05-04 06:31:25.367762+00	1	admin1	관리자	admin	AUTH_LOGIN_SUCCESS	admin_user	admin1	POST	/api/auth/login	192.168.146.95	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	{"user_id":1,"role":"admin"}	1	\N
2	2026-05-05 23:31:43.025675+00	1	admin1	관리자	admin	AUTH_LOGIN_SUCCESS	admin_user	admin1	POST	/api/auth/login	192.168.146.95	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	{"user_id":1,"role":"admin"}	1	\N
5	2026-05-06 01:39:32.304785+00	1	admin1	관리자	admin	AUTH_LOGIN_SUCCESS	admin_user	admin1	POST	/api/auth/login	192.168.146.95	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	{"user_id":1,"role":"admin"}	1	\N
9	2026-05-06 07:42:43.867901+00	8	test1	테스트(샌드박스)	admin	AUTH_LOGIN_SUCCESS	admin_user	test1	POST	/api/auth/login	192.168.146.95	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	{"user_id":8,"role":"admin"}	1	\N
11	2026-05-11 03:57:15.91674+00	1	admin1	관리자	admin	AUTH_LOGIN_SUCCESS	admin_user	admin1	POST	/api/auth/login	10.172.14.90	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	{"user_id":1,"role":"admin"}	1	\N
12	2026-05-11 04:07:44.374201+00	8	test1	테스트(샌드박스)	admin	AUTH_LOGIN_SUCCESS	admin_user	test1	POST	/api/auth/login	192.168.146.95	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	{"user_id":8,"role":"admin"}	1	\N
19	2026-05-12 00:01:28.226139+00	8	test1	테스트(샌드박스)	admin	AUTH_LOGIN_SUCCESS	admin_user	test1	POST	/api/auth/login	192.168.146.95	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	{"user_id":8,"role":"admin"}	1	\N
\.


--
-- Data for Name: qa_audit_logs__sandbox_snapshot; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.qa_audit_logs__sandbox_snapshot (audit_id, created_at, actor_user_id, actor_login_id, actor_display_name, actor_role, action, resource_type, resource_id, http_method, http_path, client_ip, user_agent, detail_json, success, error_message) FROM stdin;
1	2026-05-04 06:31:25.367762+00	1	admin1	관리자	admin	AUTH_LOGIN_SUCCESS	admin_user	admin1	POST	/api/auth/login	192.168.146.95	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	{"user_id":1,"role":"admin"}	1	\N
2	2026-05-05 23:31:43.025675+00	1	admin1	관리자	admin	AUTH_LOGIN_SUCCESS	admin_user	admin1	POST	/api/auth/login	192.168.146.95	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	{"user_id":1,"role":"admin"}	1	\N
5	2026-05-06 01:39:32.304785+00	1	admin1	관리자	admin	AUTH_LOGIN_SUCCESS	admin_user	admin1	POST	/api/auth/login	192.168.146.95	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	{"user_id":1,"role":"admin"}	1	\N
9	2026-05-06 07:42:43.867901+00	8	test1	테스트(샌드박스)	admin	AUTH_LOGIN_SUCCESS	admin_user	test1	POST	/api/auth/login	192.168.146.95	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	{"user_id":8,"role":"admin"}	1	\N
11	2026-05-11 03:57:15.91674+00	1	admin1	관리자	admin	AUTH_LOGIN_SUCCESS	admin_user	admin1	POST	/api/auth/login	10.172.14.90	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	{"user_id":1,"role":"admin"}	1	\N
12	2026-05-11 04:07:44.374201+00	8	test1	테스트(샌드박스)	admin	AUTH_LOGIN_SUCCESS	admin_user	test1	POST	/api/auth/login	192.168.146.95	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36	{"user_id":8,"role":"admin"}	1	\N
\.


--
-- Data for Name: qa_calls; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.qa_calls ("ID", "CALL_SEQ", "CDATE", "UID", "AI_SCORE", "TOTAL_SCORE", department, role, ai_analysis_target, ai_analysis_reason, voc_code, promotion_code) FROM stdin;
QA-20260308-0001	C-20260308-100001	2026-03-08T09:15:22+09:00	QA-20260308-0001	72.09	70.93	컬렉션관리부	PDS1	\N	\N	\N	\N
QA-20260308-0002	C-20260308-100002	2026-03-08T10:32:48+09:00	QA-20260308-0002	86.21	86.21	컬렉션관리부	PDS2	\N	\N	\N	\N
QA-20260308-0003	C-20260308-100003	2026-03-08T11:45:11+09:00	QA-20260308-0003	96.43	97.62	컬렉션관리부	PDS3	\N	\N	\N	\N
QA-20260308-0004	C-20260308-100004	2026-03-08T13:20:39+09:00	QA-20260308-0004	61.9	61.9	컬렉션관리부	수동대인	\N	\N	\N	\N
QA-20260308-0005	C-20260308-100005	2026-03-08T14:35:02+09:00	QA-20260308-0005	87.78	88.89	컬렉션관리부	인바운드	\N	\N	\N	\N
QA-20260308-0006	C-20260308-100006	2026-03-08T15:10:14+09:00	QA-20260308-0006	0	0	소비자보호부	전체	O	통화길이 180초 이상 & 금칙어 미감지 & 적합성 설문 진행	VOC-A12	PROM-B05
QA-20260308-0007	C-20260308-100007	2026-03-08T16:05:33+09:00	QA-20260308-0007	0	0	소비자보호부	전체	O	통화길이 240초 이상 & VOC 코드 분석 대상	VOC-A07	PROM-C11
QA-20260308-0008	C-20260308-100008	2026-03-08T16:50:21+09:00	QA-20260308-0008	0	0	소비자보호부	전체	X	통화길이 60초 미만 & 금칙어 미발견	VOC-Z01	PROM-Z00
\.


--
-- Data for Name: qa_calls__sandbox_snapshot; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.qa_calls__sandbox_snapshot ("ID", "CALL_SEQ", "CDATE", "UID", "AI_SCORE", "TOTAL_SCORE", department, role, ai_analysis_target, ai_analysis_reason, voc_code, promotion_code) FROM stdin;
QA-20260308-0001	C-20260308-100001	2026-03-08T09:15:22+09:00	QA-20260308-0001	72.09	70.93	컬렉션관리부	PDS1	\N	\N	\N	\N
QA-20260308-0002	C-20260308-100002	2026-03-08T10:32:48+09:00	QA-20260308-0002	86.21	86.21	컬렉션관리부	PDS2	\N	\N	\N	\N
QA-20260308-0003	C-20260308-100003	2026-03-08T11:45:11+09:00	QA-20260308-0003	96.43	97.62	컬렉션관리부	PDS3	\N	\N	\N	\N
QA-20260308-0004	C-20260308-100004	2026-03-08T13:20:39+09:00	QA-20260308-0004	61.9	61.9	컬렉션관리부	수동대인	\N	\N	\N	\N
QA-20260308-0005	C-20260308-100005	2026-03-08T14:35:02+09:00	QA-20260308-0005	87.78	88.89	컬렉션관리부	인바운드	\N	\N	\N	\N
QA-20260308-0006	C-20260308-100006	2026-03-08T15:10:14+09:00	QA-20260308-0006	0	0	소비자보호부	전체	O	통화길이 180초 이상 & 금칙어 미감지 & 적합성 설문 진행	VOC-A12	PROM-B05
QA-20260308-0007	C-20260308-100007	2026-03-08T16:05:33+09:00	QA-20260308-0007	0	0	소비자보호부	전체	O	통화길이 240초 이상 & VOC 코드 분석 대상	VOC-A07	PROM-C11
QA-20260308-0008	C-20260308-100008	2026-03-08T16:50:21+09:00	QA-20260308-0008	0	0	소비자보호부	전체	X	통화길이 60초 미만 & 금칙어 미발견	VOC-Z01	PROM-Z00
\.


--
-- Data for Name: qa_call_item_evidence; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.qa_call_item_evidence ("ID", order_no, category, item, agent_utterance, validation_time) FROM stdin;
QA-20260308-0001	1	친절도	인사말, 소속, 성명 모두 정확하게 시행	안녕하세요 신한카드 컬렉션관리부 김민지 상담원입니다.	배점 3
QA-20260308-0001	2	친절도	본인 확인이 정확하게 이루어진 경우	본인 확인을 위해 성함과 생년월일 부탁드립니다.	배점 4
QA-20260308-0001	3	친절도	종료 인사 시행	오늘 통화 감사드립니다. 좋은 하루 보내세요.	배점 3
QA-20260308-0001	4	친절도	회원 상황에 맞는 속도와 적절한 음성 (일반적인 음성)	네 그럼 3월 13일 금요일로 메모해 두겠습니다. 입금 예정일에 미입금 시 다시 안내드릴 수 있습니다.	배점 5
QA-20260308-0001	5	친절도	상황에 맞는 고객 중심의 언어 사용	혹시 정확하게 어느 요일에 입금이 가능하실까요?	배점 5
QA-20260308-0001	6	맞춤 응대 스킬	회원에 대한 경청, 공감 표현 및 호응도가 평이함	네 그럼 3월 13일 금요일로 메모해 두겠습니다. 입금 예정일에 미입금 시 다시 안내드릴 수 있습니다.	배점 16
QA-20260308-0001	7	맞춤 응대 스킬	회원의 입금 계획을 이끌어내는 능력 및 대안제시가 일반적임	혹시 정확하게 어느 요일에 입금이 가능하실까요?	배점 20
QA-20260308-0001	8	업무 정확도	회원의 요청사항 및 약속 건에 대한 정확하고 완벽한 업무 처리	네 그럼 3월 13일 금요일로 메모해 두겠습니다. 입금 예정일에 미입금 시 다시 안내드릴 수 있습니다.	배점 20
QA-20260308-0001	9	사후 처리	정확하고 완벽한 사후처리 및 이력 등록	네 그럼 3월 13일 금요일로 메모해 두겠습니다. 입금 예정일에 미입금 시 다시 안내드릴 수 있습니다.	배점 10
QA-20260308-0002	1	친절도	인사말, 소속, 성명 모두 정확하게 시행	안녕하세요 신한카드 컬렉션관리부 박서연 상담원입니다.	배점 3
QA-20260308-0002	2	친절도	본인 확인이 정확하게 이루어진 경우	본인 확인을 위해 가입자 성함과 생년월일을 부탁드리겠습니다.	배점 4
QA-20260308-0002	3	친절도	종료 인사 시행	약속 내용은 시스템에 등록해 두겠습니다. 좋은 하루 되십시오.	배점 3
QA-20260308-0002	4	친절도	회원 상황에 맞는 속도와 적절한 음성 (일반적인 음성)	네 가능하시면 분할 안내 도와드리겠습니다. 우선 다음 주 화요일까지 70만 원 먼저 입금하시고 나머지 잔액은 4월 5일까지 처리하시는 안이 어떠실까요?	배점 4
QA-20260308-0002	5	친절도	상황에 맞는 고객 중심의 언어 사용	네 가능하시면 분할 안내 도와드리겠습니다. 우선 다음 주 화요일까지 70만 원 먼저 입금하시고 나머지 잔액은 4월 5일까지 처리하시는 안이 어떠실까요?	배점 3
QA-20260308-0002	6	맞춤 응대 스킬	회원에 대한 경청, 공감 표현 및 호응도가 평이함	네 가능하시면 분할 안내 도와드리겠습니다. 우선 다음 주 화요일까지 70만 원 먼저 입금하시고 나머지 잔액은 4월 5일까지 처리하시는 안이 어떠실까요?	배점 20
QA-20260308-0002	7	맞춤 응대 스킬	회원의 입금 계획을 이끌어내는 능력 및 대안제시가 일반적임	네 가능하시면 분할 안내 도와드리겠습니다. 우선 다음 주 화요일까지 70만 원 먼저 입금하시고 나머지 잔액은 4월 5일까지 처리하시는 안이 어떠실까요?	배점 20
QA-20260308-0002	8	업무 정확도	회원의 요청사항 및 약속 건에 대한 정확하고 완벽한 업무 처리	감사합니다. 약속 일자에 미입금 시 추가 연락이 발생할 수 있는 점 양해 부탁드립니다.	배점 20
QA-20260308-0002	9	사후 처리	정확하고 완벽한 사후처리 및 이력 등록	약속 내용은 시스템에 등록해 두겠습니다. 좋은 하루 되십시오.	배점 10
QA-20260308-0003	1	친절도	인사말, 소속, 성명 모두 정확하게 시행	안녕하세요 신한카드 컬렉션관리부 이수빈 상담원입니다.	배점 3
QA-20260308-0003	2	친절도	본인 확인이 정확하게 이루어진 경우	본인 확인을 위해 성함과 생년월일을 말씀해 주시겠습니까?	배점 4
QA-20260308-0003	3	친절도	종료 인사 시행	오늘 시간 내주셔서 감사합니다. 건강하시고 좋은 하루 보내십시오.	배점 3
QA-20260308-0003	4	친절도	회원 상황에 맞는 속도와 적절한 음성 (일반적인 음성)	충분히 이해됩니다. 회원님 상황에 맞춰 분할 일정을 같이 검토해 드리겠습니다. 혹시 매달 가능한 금액 범위가 어느 정도이실까요?	배점 4
QA-20260308-0003	5	친절도	상황에 맞는 고객 중심의 언어 사용	충분히 이해됩니다. 회원님 상황에 맞춰 분할 일정을 같이 검토해 드리겠습니다. 혹시 매달 가능한 금액 범위가 어느 정도이실까요?	배점 10
QA-20260308-0003	6	맞춤 응대 스킬	회원에 대한 경청, 공감 표현 및 호응도가 평이함	충분히 이해됩니다. 회원님 상황에 맞춰 분할 일정을 같이 검토해 드리겠습니다. 혹시 매달 가능한 금액 범위가 어느 정도이실까요?	배점 10
QA-20260308-0003	7	맞춤 응대 스킬	회원의 입금 계획을 이끌어내는 능력 및 대안제시가 일반적임	감사합니다. 그러면 60만 원씩 6회 분할로 진행하시고, 첫 회 입금일은 3월 20일로 잡아 드릴까요?	배점 20
QA-20260308-0003	8	업무 정확도	회원의 요청사항 및 약속 건에 대한 정확하고 완벽한 업무 처리	네 약정 내용 다시 한번 확인드리겠습니다. 월 60만 원, 총 6회, 첫 회 3월 20일 입금. 맞으실까요?	배점 20
QA-20260308-0003	9	사후 처리	정확하고 완벽한 사후처리 및 이력 등록	감사합니다. 약정 내용은 시스템에 정확히 등록하고 안내 문자 발송 드리겠습니다.	배점 10
QA-20260308-0004	1	친절도	인사말, 소속, 성명 모두 정확하게 시행	여보세요 신한카드입니다.	배점 3
QA-20260308-0004	2	친절도	본인 확인이 정확하게 이루어진 경우	박지훈 회원님 되시죠?	배점 4
QA-20260308-0004	3	친절도	종료 인사 시행	네 끊겠습니다.	배점 3
QA-20260308-0004	4	친절도	회원 상황에 맞는 속도와 적절한 음성 (일반적인 음성)	잠깐만 시간 좀 내주세요. 이번 주 안에 입금 가능하세요?	배점 4
QA-20260308-0004	5	친절도	상황에 맞는 고객 중심의 언어 사용	잠깐만 시간 좀 내주세요. 이번 주 안에 입금 가능하세요?	배점 10
QA-20260308-0004	6	맞춤 응대 스킬	회원에 대한 경청, 공감 표현 및 호응도가 평이함	잠깐만 시간 좀 내주세요. 이번 주 안에 입금 가능하세요?	배점 10
QA-20260308-0004	7	맞춤 응대 스킬	회원의 입금 계획을 이끌어내는 능력 및 대안제시가 일반적임	잠깐만 시간 좀 내주세요. 이번 주 안에 입금 가능하세요?	배점 20
QA-20260308-0004	8	업무 정확도	회원의 요청사항 및 약속 건에 대한 정확하고 완벽한 업무 처리	잠깐만 시간 좀 내주세요. 이번 주 안에 입금 가능하세요?	배점 20
QA-20260308-0004	9	사후 처리	정확하고 완벽한 사후처리 및 이력 등록	네 끊겠습니다.	배점 10
QA-20260308-0005	1	친절도	인사말, 소속, 성명 모두 정확하게 시행	안녕하세요 신한카드 고객센터 정유나 상담원입니다. 무엇을 도와드릴까요?	배점 5
QA-20260308-0005	2	친절도	본인 확인이 정확하게 이루어진 경우	네 도와드리겠습니다. 본인 확인을 위해 성함과 생년월일 부탁드립니다.	배점 5
QA-20260308-0005	3	친절도	종료 인사 시행	별말씀을요. 다른 문의 없으시면 좋은 하루 보내십시오.	배점 5
QA-20260308-0005	4	친절도	회원 상황에 맞는 속도와 적절한 음성 (일반적인 음성)	오늘 영업시간 내 입금 처리되시면 추가 연체이자는 부과되지 않습니다. 가상계좌로 안내 드릴까요?	배점 5
QA-20260308-0005	5	친절도	상황에 맞는 고객 중심의 언어 사용	오늘 영업시간 내 입금 처리되시면 추가 연체이자는 부과되지 않습니다. 가상계좌로 안내 드릴까요?	배점 10
QA-20260308-0005	6	맞춤 응대 스킬	회원에 대한 경청, 공감 표현 및 호응도가 평이함	오늘 영업시간 내 입금 처리되시면 추가 연체이자는 부과되지 않습니다. 가상계좌로 안내 드릴까요?	배점 20
QA-20260308-0005	7	맞춤 응대 스킬	회원의 입금 계획을 이끌어내는 능력 및 대안제시가 일반적임	안내드린 가상계좌로 56만 2천 원 입금하시면 즉시 정상 처리됩니다. 처리 후 문자로 알림 받아보실 수 있습니다.	배점 15
QA-20260308-0005	8	업무 정확도	회원의 요청사항 및 약속 건에 대한 정확하고 완벽한 업무 처리	안내드린 가상계좌로 56만 2천 원 입금하시면 즉시 정상 처리됩니다. 처리 후 문자로 알림 받아보실 수 있습니다.	배점 15
QA-20260308-0005	9	사후 처리	정확하고 완벽한 사후처리 및 이력 등록	안내드린 가상계좌로 56만 2천 원 입금하시면 즉시 정상 처리됩니다. 처리 후 문자로 알림 받아보실 수 있습니다.	배점 10
\.


--
-- Data for Name: qa_checklist_rows__sandbox_snapshot; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.qa_checklist_rows__sandbox_snapshot ("ID", order_no, category, item, agent_utterance, validation_time) FROM stdin;
QA-20260308-0001	1	친절도	인사말, 소속, 성명 모두 정확하게 시행	안녕하세요 신한카드 컬렉션관리부 김민지 상담원입니다.	배점 3
QA-20260308-0001	2	친절도	본인 확인이 정확하게 이루어진 경우	본인 확인을 위해 성함과 생년월일 부탁드립니다.	배점 4
QA-20260308-0001	3	친절도	종료 인사 시행	오늘 통화 감사드립니다. 좋은 하루 보내세요.	배점 3
QA-20260308-0001	4	친절도	회원 상황에 맞는 속도와 적절한 음성 (일반적인 음성)	네 그럼 3월 13일 금요일로 메모해 두겠습니다. 입금 예정일에 미입금 시 다시 안내드릴 수 있습니다.	배점 5
QA-20260308-0001	5	친절도	상황에 맞는 고객 중심의 언어 사용	혹시 정확하게 어느 요일에 입금이 가능하실까요?	배점 5
QA-20260308-0001	6	맞춤 응대 스킬	회원에 대한 경청, 공감 표현 및 호응도가 평이함	네 그럼 3월 13일 금요일로 메모해 두겠습니다. 입금 예정일에 미입금 시 다시 안내드릴 수 있습니다.	배점 16
QA-20260308-0001	7	맞춤 응대 스킬	회원의 입금 계획을 이끌어내는 능력 및 대안제시가 일반적임	혹시 정확하게 어느 요일에 입금이 가능하실까요?	배점 20
QA-20260308-0001	8	업무 정확도	회원의 요청사항 및 약속 건에 대한 정확하고 완벽한 업무 처리	네 그럼 3월 13일 금요일로 메모해 두겠습니다. 입금 예정일에 미입금 시 다시 안내드릴 수 있습니다.	배점 20
QA-20260308-0001	9	사후 처리	정확하고 완벽한 사후처리 및 이력 등록	네 그럼 3월 13일 금요일로 메모해 두겠습니다. 입금 예정일에 미입금 시 다시 안내드릴 수 있습니다.	배점 10
QA-20260308-0002	1	친절도	인사말, 소속, 성명 모두 정확하게 시행	안녕하세요 신한카드 컬렉션관리부 박서연 상담원입니다.	배점 3
QA-20260308-0002	2	친절도	본인 확인이 정확하게 이루어진 경우	본인 확인을 위해 가입자 성함과 생년월일을 부탁드리겠습니다.	배점 4
QA-20260308-0002	3	친절도	종료 인사 시행	약속 내용은 시스템에 등록해 두겠습니다. 좋은 하루 되십시오.	배점 3
QA-20260308-0002	4	친절도	회원 상황에 맞는 속도와 적절한 음성 (일반적인 음성)	네 가능하시면 분할 안내 도와드리겠습니다. 우선 다음 주 화요일까지 70만 원 먼저 입금하시고 나머지 잔액은 4월 5일까지 처리하시는 안이 어떠실까요?	배점 4
QA-20260308-0002	5	친절도	상황에 맞는 고객 중심의 언어 사용	네 가능하시면 분할 안내 도와드리겠습니다. 우선 다음 주 화요일까지 70만 원 먼저 입금하시고 나머지 잔액은 4월 5일까지 처리하시는 안이 어떠실까요?	배점 3
QA-20260308-0002	6	맞춤 응대 스킬	회원에 대한 경청, 공감 표현 및 호응도가 평이함	네 가능하시면 분할 안내 도와드리겠습니다. 우선 다음 주 화요일까지 70만 원 먼저 입금하시고 나머지 잔액은 4월 5일까지 처리하시는 안이 어떠실까요?	배점 20
QA-20260308-0002	7	맞춤 응대 스킬	회원의 입금 계획을 이끌어내는 능력 및 대안제시가 일반적임	네 가능하시면 분할 안내 도와드리겠습니다. 우선 다음 주 화요일까지 70만 원 먼저 입금하시고 나머지 잔액은 4월 5일까지 처리하시는 안이 어떠실까요?	배점 20
QA-20260308-0002	8	업무 정확도	회원의 요청사항 및 약속 건에 대한 정확하고 완벽한 업무 처리	감사합니다. 약속 일자에 미입금 시 추가 연락이 발생할 수 있는 점 양해 부탁드립니다.	배점 20
QA-20260308-0002	9	사후 처리	정확하고 완벽한 사후처리 및 이력 등록	약속 내용은 시스템에 등록해 두겠습니다. 좋은 하루 되십시오.	배점 10
QA-20260308-0003	1	친절도	인사말, 소속, 성명 모두 정확하게 시행	안녕하세요 신한카드 컬렉션관리부 이수빈 상담원입니다.	배점 3
QA-20260308-0003	2	친절도	본인 확인이 정확하게 이루어진 경우	본인 확인을 위해 성함과 생년월일을 말씀해 주시겠습니까?	배점 4
QA-20260308-0003	3	친절도	종료 인사 시행	오늘 시간 내주셔서 감사합니다. 건강하시고 좋은 하루 보내십시오.	배점 3
QA-20260308-0003	4	친절도	회원 상황에 맞는 속도와 적절한 음성 (일반적인 음성)	충분히 이해됩니다. 회원님 상황에 맞춰 분할 일정을 같이 검토해 드리겠습니다. 혹시 매달 가능한 금액 범위가 어느 정도이실까요?	배점 4
QA-20260308-0003	5	친절도	상황에 맞는 고객 중심의 언어 사용	충분히 이해됩니다. 회원님 상황에 맞춰 분할 일정을 같이 검토해 드리겠습니다. 혹시 매달 가능한 금액 범위가 어느 정도이실까요?	배점 10
QA-20260308-0003	6	맞춤 응대 스킬	회원에 대한 경청, 공감 표현 및 호응도가 평이함	충분히 이해됩니다. 회원님 상황에 맞춰 분할 일정을 같이 검토해 드리겠습니다. 혹시 매달 가능한 금액 범위가 어느 정도이실까요?	배점 10
QA-20260308-0003	7	맞춤 응대 스킬	회원의 입금 계획을 이끌어내는 능력 및 대안제시가 일반적임	감사합니다. 그러면 60만 원씩 6회 분할로 진행하시고, 첫 회 입금일은 3월 20일로 잡아 드릴까요?	배점 20
QA-20260308-0003	8	업무 정확도	회원의 요청사항 및 약속 건에 대한 정확하고 완벽한 업무 처리	네 약정 내용 다시 한번 확인드리겠습니다. 월 60만 원, 총 6회, 첫 회 3월 20일 입금. 맞으실까요?	배점 20
QA-20260308-0003	9	사후 처리	정확하고 완벽한 사후처리 및 이력 등록	감사합니다. 약정 내용은 시스템에 정확히 등록하고 안내 문자 발송 드리겠습니다.	배점 10
QA-20260308-0004	1	친절도	인사말, 소속, 성명 모두 정확하게 시행	여보세요 신한카드입니다.	배점 3
QA-20260308-0004	2	친절도	본인 확인이 정확하게 이루어진 경우	박지훈 회원님 되시죠?	배점 4
QA-20260308-0004	3	친절도	종료 인사 시행	네 끊겠습니다.	배점 3
QA-20260308-0004	4	친절도	회원 상황에 맞는 속도와 적절한 음성 (일반적인 음성)	잠깐만 시간 좀 내주세요. 이번 주 안에 입금 가능하세요?	배점 4
QA-20260308-0004	5	친절도	상황에 맞는 고객 중심의 언어 사용	잠깐만 시간 좀 내주세요. 이번 주 안에 입금 가능하세요?	배점 10
QA-20260308-0004	6	맞춤 응대 스킬	회원에 대한 경청, 공감 표현 및 호응도가 평이함	잠깐만 시간 좀 내주세요. 이번 주 안에 입금 가능하세요?	배점 10
QA-20260308-0004	7	맞춤 응대 스킬	회원의 입금 계획을 이끌어내는 능력 및 대안제시가 일반적임	잠깐만 시간 좀 내주세요. 이번 주 안에 입금 가능하세요?	배점 20
QA-20260308-0004	8	업무 정확도	회원의 요청사항 및 약속 건에 대한 정확하고 완벽한 업무 처리	잠깐만 시간 좀 내주세요. 이번 주 안에 입금 가능하세요?	배점 20
QA-20260308-0004	9	사후 처리	정확하고 완벽한 사후처리 및 이력 등록	네 끊겠습니다.	배점 10
QA-20260308-0005	1	친절도	인사말, 소속, 성명 모두 정확하게 시행	안녕하세요 신한카드 고객센터 정유나 상담원입니다. 무엇을 도와드릴까요?	배점 5
QA-20260308-0005	2	친절도	본인 확인이 정확하게 이루어진 경우	네 도와드리겠습니다. 본인 확인을 위해 성함과 생년월일 부탁드립니다.	배점 5
QA-20260308-0005	3	친절도	종료 인사 시행	별말씀을요. 다른 문의 없으시면 좋은 하루 보내십시오.	배점 5
QA-20260308-0005	4	친절도	회원 상황에 맞는 속도와 적절한 음성 (일반적인 음성)	오늘 영업시간 내 입금 처리되시면 추가 연체이자는 부과되지 않습니다. 가상계좌로 안내 드릴까요?	배점 5
QA-20260308-0005	5	친절도	상황에 맞는 고객 중심의 언어 사용	오늘 영업시간 내 입금 처리되시면 추가 연체이자는 부과되지 않습니다. 가상계좌로 안내 드릴까요?	배점 10
QA-20260308-0005	6	맞춤 응대 스킬	회원에 대한 경청, 공감 표현 및 호응도가 평이함	오늘 영업시간 내 입금 처리되시면 추가 연체이자는 부과되지 않습니다. 가상계좌로 안내 드릴까요?	배점 20
QA-20260308-0005	7	맞춤 응대 스킬	회원의 입금 계획을 이끌어내는 능력 및 대안제시가 일반적임	안내드린 가상계좌로 56만 2천 원 입금하시면 즉시 정상 처리됩니다. 처리 후 문자로 알림 받아보실 수 있습니다.	배점 15
QA-20260308-0005	8	업무 정확도	회원의 요청사항 및 약속 건에 대한 정확하고 완벽한 업무 처리	안내드린 가상계좌로 56만 2천 원 입금하시면 즉시 정상 처리됩니다. 처리 후 문자로 알림 받아보실 수 있습니다.	배점 15
QA-20260308-0005	9	사후 처리	정확하고 완벽한 사후처리 및 이력 등록	안내드린 가상계좌로 56만 2천 원 입금하시면 즉시 정상 처리됩니다. 처리 후 문자로 알림 받아보실 수 있습니다.	배점 10
\.


--
-- Data for Name: qa_consumer_ai_categories; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.qa_consumer_ai_categories ("ID", category_no, major_category, sub_category, score) FROM stdin;
QA-20260308-0006	1	1. 리스크 관리	A. 법적 리스크 감지	12.00
QA-20260308-0006	2	1. 리스크 관리	B. 민원 전환 가능성	18.00
QA-20260308-0006	3	1. 리스크 관리	C. 컴플라이언스 위반	22.00
QA-20260308-0006	4	2. 품질 관리	A. 응대 품질 저하	10.00
QA-20260308-0006	5	2. 품질 관리	B. 설명 부족	20.00
QA-20260308-0006	6	2. 품질 관리	C. 우수 응대	78.00
QA-20260308-0006	7	3. 프로세스 개선	A. 고객 제안	35.00
QA-20260308-0006	8	3. 프로세스 개선	B. 반복 문의	15.00
QA-20260308-0006	9	3. 프로세스 개선	C. 시스템 오류	8.00
QA-20260308-0006	10	4. 비즈니스 인사이트	A. 상품 관심	65.00
QA-20260308-0006	11	4. 비즈니스 인사이트	B. 경쟁사 언급	9.00
QA-20260308-0006	12	4. 비즈니스 인사이트	C. 해지 사유	12.00
QA-20260308-0007	1	1. 리스크 관리	A. 법적 리스크 감지	28.00
QA-20260308-0007	2	1. 리스크 관리	B. 민원 전환 가능성	62.00
QA-20260308-0007	3	1. 리스크 관리	C. 컴플라이언스 위반	74.00
QA-20260308-0007	4	2. 품질 관리	A. 응대 품질 저하	45.00
QA-20260308-0007	5	2. 품질 관리	B. 설명 부족	68.00
QA-20260308-0007	6	2. 품질 관리	C. 우수 응대	18.00
QA-20260308-0007	7	3. 프로세스 개선	A. 고객 제안	20.00
QA-20260308-0007	8	3. 프로세스 개선	B. 반복 문의	12.00
QA-20260308-0007	9	3. 프로세스 개선	C. 시스템 오류	10.00
QA-20260308-0007	10	4. 비즈니스 인사이트	A. 상품 관심	38.00
QA-20260308-0007	11	4. 비즈니스 인사이트	B. 경쟁사 언급	14.00
QA-20260308-0007	12	4. 비즈니스 인사이트	C. 해지 사유	22.00
QA-20260308-0008	1	1. 리스크 관리	A. 법적 리스크 감지	8.00
QA-20260308-0008	2	1. 리스크 관리	B. 민원 전환 가능성	12.00
QA-20260308-0008	3	1. 리스크 관리	C. 컴플라이언스 위반	15.00
QA-20260308-0008	4	2. 품질 관리	A. 응대 품질 저하	18.00
QA-20260308-0008	5	2. 품질 관리	B. 설명 부족	20.00
QA-20260308-0008	6	2. 품질 관리	C. 우수 응대	22.00
QA-20260308-0008	7	3. 프로세스 개선	A. 고객 제안	10.00
QA-20260308-0008	8	3. 프로세스 개선	B. 반복 문의	6.00
QA-20260308-0008	9	3. 프로세스 개선	C. 시스템 오류	4.00
QA-20260308-0008	10	4. 비즈니스 인사이트	A. 상품 관심	14.00
QA-20260308-0008	11	4. 비즈니스 인사이트	B. 경쟁사 언급	3.00
QA-20260308-0008	12	4. 비즈니스 인사이트	C. 해지 사유	9.00
\.


--
-- Data for Name: qa_consumer_ai_categories__sandbox_snapshot; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.qa_consumer_ai_categories__sandbox_snapshot ("ID", category_no, major_category, sub_category, score) FROM stdin;
QA-20260308-0006	1	1. 리스크 관리	A. 법적 리스크 감지	12.00
QA-20260308-0006	2	1. 리스크 관리	B. 민원 전환 가능성	18.00
QA-20260308-0006	3	1. 리스크 관리	C. 컴플라이언스 위반	22.00
QA-20260308-0006	4	2. 품질 관리	A. 응대 품질 저하	10.00
QA-20260308-0006	5	2. 품질 관리	B. 설명 부족	20.00
QA-20260308-0006	6	2. 품질 관리	C. 우수 응대	78.00
QA-20260308-0006	7	3. 프로세스 개선	A. 고객 제안	35.00
QA-20260308-0006	8	3. 프로세스 개선	B. 반복 문의	15.00
QA-20260308-0006	9	3. 프로세스 개선	C. 시스템 오류	8.00
QA-20260308-0006	10	4. 비즈니스 인사이트	A. 상품 관심	65.00
QA-20260308-0006	11	4. 비즈니스 인사이트	B. 경쟁사 언급	9.00
QA-20260308-0006	12	4. 비즈니스 인사이트	C. 해지 사유	12.00
QA-20260308-0007	1	1. 리스크 관리	A. 법적 리스크 감지	28.00
QA-20260308-0007	2	1. 리스크 관리	B. 민원 전환 가능성	62.00
QA-20260308-0007	3	1. 리스크 관리	C. 컴플라이언스 위반	74.00
QA-20260308-0007	4	2. 품질 관리	A. 응대 품질 저하	45.00
QA-20260308-0007	5	2. 품질 관리	B. 설명 부족	68.00
QA-20260308-0007	6	2. 품질 관리	C. 우수 응대	18.00
QA-20260308-0007	7	3. 프로세스 개선	A. 고객 제안	20.00
QA-20260308-0007	8	3. 프로세스 개선	B. 반복 문의	12.00
QA-20260308-0007	9	3. 프로세스 개선	C. 시스템 오류	10.00
QA-20260308-0007	10	4. 비즈니스 인사이트	A. 상품 관심	38.00
QA-20260308-0007	11	4. 비즈니스 인사이트	B. 경쟁사 언급	14.00
QA-20260308-0007	12	4. 비즈니스 인사이트	C. 해지 사유	22.00
QA-20260308-0008	1	1. 리스크 관리	A. 법적 리스크 감지	8.00
QA-20260308-0008	2	1. 리스크 관리	B. 민원 전환 가능성	12.00
QA-20260308-0008	3	1. 리스크 관리	C. 컴플라이언스 위반	15.00
QA-20260308-0008	4	2. 품질 관리	A. 응대 품질 저하	18.00
QA-20260308-0008	5	2. 품질 관리	B. 설명 부족	20.00
QA-20260308-0008	6	2. 품질 관리	C. 우수 응대	22.00
QA-20260308-0008	7	3. 프로세스 개선	A. 고객 제안	10.00
QA-20260308-0008	8	3. 프로세스 개선	B. 반복 문의	6.00
QA-20260308-0008	9	3. 프로세스 개선	C. 시스템 오류	4.00
QA-20260308-0008	10	4. 비즈니스 인사이트	A. 상품 관심	14.00
QA-20260308-0008	11	4. 비즈니스 인사이트	B. 경쟁사 언급	3.00
QA-20260308-0008	12	4. 비즈니스 인사이트	C. 해지 사유	9.00
\.


--
-- Data for Name: qa_consumer_eval_rows; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.qa_consumer_eval_rows ("ID", item_no, major_category, sub_no, criterion, item_text, yn, detail_text, evidence_line_no, evidence_text) FROM stdin;
QA-20260308-0008	19	4. 불완전판매개연성	5	상품설명 정확성&전달력	서비스 또는 판촉에 대한 오류 또는 미흡 안내로 추후 민원 소지 개연성이 있는가	Y	\N	3	신상품 안내드리려고 연락드렸습니다.
QA-20260308-0006	1	1. 금소법준수여부	1	고지의 의무	상담직원이 본인의 소속과 위임받은 사실 등을 고지하였는가	Y	\N	1	안녕하세요 신한카드 상품 안내 상담원 한지윤입니다. 본 통화는 품질 향상을 위해 녹취되고 있습니다.
QA-20260308-0006	2	1. 금소법준수여부	2	적합성원칙안내	연간소득과 신용점수 설문 시 특정 답변 유도 없이 안내 되었는가	Y	\N	5	감사합니다. 안내에 앞서 적합성 확인을 위해 연간 소득과 신용점수 구간을 여쭤보겠습니다.
QA-20260308-0006	3	1. 금소법준수여부	3	불공정 영업행위 금지	고객 동의 및 이해 부족임에도 상품 계약이 이뤄졌는가	Y	\N	9	지금까지 안내드린 내용에 이해되지 않으신 부분 있으실까요?
QA-20260308-0006	4	1. 금소법준수여부	4	부당권유 행위 금지	고객의 거절 의사 표명에도 마케팅 행위가 이뤄졌는가	Y	\N	3	오늘은 신용카드 신상품 더모아 카드 안내차 연락드렸습니다. 통화 가능하실까요?
QA-20260308-0006	5	1. 금소법준수여부	5	계약서류 제공 의무	상품안내장, 금소법설명서, 계약서, 핵심설명서 등 계약서류를 제공하였는가	Y	\N	11	감사합니다. 가입을 진행하시려면 이후 발송되는 상품안내장과 핵심설명서, 계약서류를 확인해 주신 뒤 동의 의사를 표시해 주시면 됩니다.
QA-20260308-0006	6	1. 금소법준수여부	6	상품설명 이해여부 확인	설명 이해 여부에 대해 상담직원이 물어보고 확인 받았는가 (고객 답변 확인 必)	Y	\N	9	지금까지 안내드린 내용에 이해되지 않으신 부분 있으실까요?
QA-20260308-0006	7	1. 금소법준수여부	7	불공정 영업행위 금지	금융상품판매업자 등이 우월적 지위를 이용하여 금융소비자의 의사에 반하여 권익을 침해하는 행위를 하였는가	Y	\N	7	감사합니다. 더모아 카드 핵심 혜택은 5천 원 미만 결제 시 잔돈을 포인트로 적립해 드리는 상품이고요, 연회비는 1만 5천 원입니다.
QA-20260308-0006	8	2. 방문판매모범규준	1	판매절차 적정성	전화 연락 거절을 위한 방법을 안내 받았는가	N	전화 연락 거절을 위한 별도 방법(수신 거부 절차 안내)이 통화 종료 직전에 안내되어 항목 충족 시점 기준 미충족	13	추가로 향후 연락을 원치 않으시면 1599-0000 으로 연락 주시면 수신 거부 처리해 드립니다. 좋은 하루 되십시오.
QA-20260308-0006	9	2. 방문판매모범규준	2	판매절차 적정성	카드 판매 인력의 소속과 성명을 안내 받았는가	Y	\N	1	안녕하세요 신한카드 상품 안내 상담원 한지윤입니다. 본 통화는 품질 향상을 위해 녹취되고 있습니다.
QA-20260308-0006	10	2. 방문판매모범규준	3	판매절차 적정성	카드 판매 인력의 신원 확인이 가능함을 안내 받았는가	Y	\N	1	안녕하세요 신한카드 상품 안내 상담원 한지윤입니다. 본 통화는 품질 향상을 위해 녹취되고 있습니다.
QA-20260308-0006	11	3. 금융취약계층대상	1	설명의 의무	금융상품 판매 시 적정한 안내 속도로 판매되었는가	Y	\N	7	감사합니다. 더모아 카드 핵심 혜택은 5천 원 미만 결제 시 잔돈을 포인트로 적립해 드리는 상품이고요, 연회비는 1만 5천 원입니다.
QA-20260308-0006	12	3. 금융취약계층대상	2	설명의 의무	금융상품 판매 시 이용 동의 의사를 확인하며 강화된 권유 절차를 반영하였는가	Y	\N	11	감사합니다. 가입을 진행하시려면 이후 발송되는 상품안내장과 핵심설명서, 계약서류를 확인해 주신 뒤 동의 의사를 표시해 주시면 됩니다.
QA-20260308-0006	13	3. 금융취약계층대상	3	상품설명 이해여부 확인	금융상품 판매 시 중요사항과 유의사항에 대해 인지되도록 안내되었는가	Y	\N	7	감사합니다. 더모아 카드 핵심 혜택은 5천 원 미만 결제 시 잔돈을 포인트로 적립해 드리는 상품이고요, 연회비는 1만 5천 원입니다.
QA-20260308-0006	14	3. 금융취약계층대상	4	상품설명 이해여부 확인	판매하는 금융상품에 대한 상품·서비스에 대해 충분히 안내하고 인지 여부를 재확인하였는가	Y	\N	9	지금까지 안내드린 내용에 이해되지 않으신 부분 있으실까요?
QA-20260308-0006	15	4. 불완전판매개연성	1	상품설명 정확성&전달력	상담직원이 상품/서비스 판매 TM 목적에 대해 적합하게 안내하였는가	Y	\N	3	오늘은 신용카드 신상품 더모아 카드 안내차 연락드렸습니다. 통화 가능하실까요?
QA-20260308-0006	16	4. 불완전판매개연성	2	상품설명 정확성&전달력	정확한 발음과 차분한 속도로 고객이 잘 들리도록 명확하게 안내하였는가	Y	\N	7	감사합니다. 더모아 카드 핵심 혜택은 5천 원 미만 결제 시 잔돈을 포인트로 적립해 드리는 상품이고요, 연회비는 1만 5천 원입니다.
QA-20260308-0006	17	4. 불완전판매개연성	3	상품설명 정확성&전달력	고객의 질의에 답변을 회피하거나 동문서답을 하였는가	Y	\N	9	지금까지 안내드린 내용에 이해되지 않으신 부분 있으실까요?
QA-20260308-0006	18	4. 불완전판매개연성	4	상품설명 정확성&전달력	상품/서비스 내용 또는 제공되는 오퍼·혜택에 대해 오해의 소지가 없게 정확하게 안내하였는가	Y	\N	7	감사합니다. 더모아 카드 핵심 혜택은 5천 원 미만 결제 시 잔돈을 포인트로 적립해 드리는 상품이고요, 연회비는 1만 5천 원입니다.
QA-20260308-0006	19	4. 불완전판매개연성	5	상품설명 정확성&전달력	서비스 또는 판촉에 대한 오류 또는 미흡 안내로 추후 민원 소지 개연성이 있는가	Y	\N	7	감사합니다. 더모아 카드 핵심 혜택은 5천 원 미만 결제 시 잔돈을 포인트로 적립해 드리는 상품이고요, 연회비는 1만 5천 원입니다.
QA-20260308-0008	5	1. 금소법준수여부	5	계약서류 제공 의무	상품안내장, 금소법설명서, 계약서, 핵심설명서 등 계약서류를 제공하였는가	N	상품안내장 및 계약서류 제공 절차가 통화 내 진행되지 않음	3	신상품 안내드리려고 연락드렸습니다.
QA-20260308-0006	20	4. 불완전판매개연성	6	상품설명 정확성&전달력	상품 가입/이용 선택에 필요한 위험요소, 주의사항, 유료화 여부 등에 대한 정보 전달이 정확한가	Y	\N	7	감사합니다. 더모아 카드 핵심 혜택은 5천 원 미만 결제 시 잔돈을 포인트로 적립해 드리는 상품이고요, 연회비는 1만 5천 원입니다.
QA-20260308-0007	1	1. 금소법준수여부	1	고지의 의무	상담직원이 본인의 소속과 위임받은 사실 등을 고지하였는가	Y	\N	3	신한카드 마케팅 안내차 연락드렸습니다. 신상품 추천드리려고요.
QA-20260308-0007	2	1. 금소법준수여부	2	적합성원칙안내	연간소득과 신용점수 설문 시 특정 답변 유도 없이 안내 되었는가	N	연간 소득과 신용점수 적합성 설문이 진행되지 않음	5	잠깐이면 됩니다. Mr.Life 카드 안내드릴게요. 이거 정말 좋습니다.
QA-20260308-0007	3	1. 금소법준수여부	3	불공정 영업행위 금지	고객 동의 및 이해 부족임에도 상품 계약이 이뤄졌는가	Y	\N	15	감사합니다 그러면 가입 처리 도와드리겠습니다.
QA-20260308-0007	4	1. 금소법준수여부	4	부당권유 행위 금지	고객의 거절 의사 표명에도 마케팅 행위가 이뤄졌는가	N	고객이 '거절하면 안 되나요'라고 의사 표명했음에도 추가 권유가 이어짐	13	한 번만 더 검토해 보세요. 정말 좋습니다.
QA-20260308-0007	5	1. 금소법준수여부	5	계약서류 제공 의무	상품안내장, 금소법설명서, 계약서, 핵심설명서 등 계약서류를 제공하였는가	Y	\N	15	감사합니다 그러면 가입 처리 도와드리겠습니다.
QA-20260308-0007	6	1. 금소법준수여부	6	상품설명 이해여부 확인	설명 이해 여부에 대해 상담직원이 물어보고 확인 받았는가 (고객 답변 확인 必)	N	이해 여부 질문 후 고객의 명시적 답변 확인이 이루어지지 않음	11	그건 약관봐 하시면 되고요, 일단 가입하시면 확인 가능합니다.
QA-20260308-0007	7	1. 금소법준수여부	7	불공정 영업행위 금지	금융상품판매업자 등이 우월적 지위를 이용하여 금융소비자의 의사에 반하여 권익을 침해하는 행위를 하였는가	Y	\N	13	한 번만 더 검토해 보세요. 정말 좋습니다.
QA-20260308-0007	8	2. 방문판매모범규준	1	판매절차 적정성	전화 연락 거절을 위한 방법을 안내 받았는가	N	수신 거부·연락 거절 방법에 대한 안내가 누락됨	15	감사합니다 그러면 가입 처리 도와드리겠습니다.
QA-20260308-0007	9	2. 방문판매모범규준	2	판매절차 적정성	카드 판매 인력의 소속과 성명을 안내 받았는가	Y	\N	3	신한카드 마케팅 안내차 연락드렸습니다. 신상품 추천드리려고요.
QA-20260308-0007	10	2. 방문판매모범규준	3	판매절차 적정성	카드 판매 인력의 신원 확인이 가능함을 안내 받았는가	Y	\N	3	신한카드 마케팅 안내차 연락드렸습니다. 신상품 추천드리려고요.
QA-20260308-0007	11	3. 금융취약계층대상	1	설명의 의무	금융상품 판매 시 적정한 안내 속도로 판매되었는가	Y	\N	5	잠깐이면 됩니다. Mr.Life 카드 안내드릴게요. 이거 정말 좋습니다.
QA-20260308-0007	12	3. 금융취약계층대상	2	설명의 의무	금융상품 판매 시 이용 동의 의사를 확인하며 강화된 권유 절차를 반영하였는가	Y	\N	15	감사합니다 그러면 가입 처리 도와드리겠습니다.
QA-20260308-0007	13	3. 금융취약계층대상	3	상품설명 이해여부 확인	금융상품 판매 시 중요사항과 유의사항에 대해 인지되도록 안내되었는가	Y	\N	7	고객님 같으신 분들은 누구나 무조건 가입하시는 상품이고요, 손해없음 보장입니다.
QA-20260308-0007	14	3. 금융취약계층대상	4	상품설명 이해여부 확인	판매하는 금융상품에 대한 상품·서비스에 대해 충분히 안내하고 인지 여부를 재확인하였는가	Y	\N	9	연회비는 거의무료 수준이에요. 자세한 건 나중에 안내드릴게요.
QA-20260308-0007	15	4. 불완전판매개연성	1	상품설명 정확성&전달력	상담직원이 상품/서비스 판매 TM 목적에 대해 적합하게 안내하였는가	Y	\N	3	신한카드 마케팅 안내차 연락드렸습니다. 신상품 추천드리려고요.
QA-20260308-0007	16	4. 불완전판매개연성	2	상품설명 정확성&전달력	정확한 발음과 차분한 속도로 고객이 잘 들리도록 명확하게 안내하였는가	Y	\N	5	잠깐이면 됩니다. Mr.Life 카드 안내드릴게요. 이거 정말 좋습니다.
QA-20260308-0007	17	4. 불완전판매개연성	3	상품설명 정확성&전달력	고객의 질의에 답변을 회피하거나 동문서답을 하였는가	N	연회비 등 고객 질의에 '약관에 다 나와 있다'며 회피성 답변을 함	11	그건 약관봐 하시면 되고요, 일단 가입하시면 확인 가능합니다.
QA-20260308-0007	18	4. 불완전판매개연성	4	상품설명 정확성&전달력	상품/서비스 내용 또는 제공되는 오퍼·혜택에 대해 오해의 소지가 없게 정확하게 안내하였는가	Y	\N	7	고객님 같으신 분들은 누구나 무조건 가입하시는 상품이고요, 손해없음 보장입니다.
QA-20260308-0007	19	4. 불완전판매개연성	5	상품설명 정확성&전달력	서비스 또는 판촉에 대한 오류 또는 미흡 안내로 추후 민원 소지 개연성이 있는가	Y	\N	5	잠깐이면 됩니다. Mr.Life 카드 안내드릴게요. 이거 정말 좋습니다.
QA-20260308-0007	20	4. 불완전판매개연성	6	상품설명 정확성&전달력	상품 가입/이용 선택에 필요한 위험요소, 주의사항, 유료화 여부 등에 대한 정보 전달이 정확한가	Y	\N	9	연회비는 거의무료 수준이에요. 자세한 건 나중에 안내드릴게요.
QA-20260308-0008	1	1. 금소법준수여부	1	고지의 의무	상담직원이 본인의 소속과 위임받은 사실 등을 고지하였는가	Y	\N	1	안녕하세요 신한카드입니다.
QA-20260308-0008	2	1. 금소법준수여부	2	적합성원칙안내	연간소득과 신용점수 설문 시 특정 답변 유도 없이 안내 되었는가	Y	\N	3	신상품 안내드리려고 연락드렸습니다.
QA-20260308-0008	3	1. 금소법준수여부	3	불공정 영업행위 금지	고객 동의 및 이해 부족임에도 상품 계약이 이뤄졌는가	Y	\N	5	네 알겠습니다. 향후 연락 원치 않으시면 수신 거부 등록 도와드릴까요?
QA-20260308-0008	4	1. 금소법준수여부	4	부당권유 행위 금지	고객의 거절 의사 표명에도 마케팅 행위가 이뤄졌는가	Y	\N	5	네 알겠습니다. 향후 연락 원치 않으시면 수신 거부 등록 도와드릴까요?
QA-20260308-0008	6	1. 금소법준수여부	6	상품설명 이해여부 확인	설명 이해 여부에 대해 상담직원이 물어보고 확인 받았는가 (고객 답변 확인 必)	Y	\N	5	네 알겠습니다. 향후 연락 원치 않으시면 수신 거부 등록 도와드릴까요?
QA-20260308-0008	7	1. 금소법준수여부	7	불공정 영업행위 금지	금융상품판매업자 등이 우월적 지위를 이용하여 금융소비자의 의사에 반하여 권익을 침해하는 행위를 하였는가	Y	\N	5	네 알겠습니다. 향후 연락 원치 않으시면 수신 거부 등록 도와드릴까요?
QA-20260308-0008	8	2. 방문판매모범규준	1	판매절차 적정성	전화 연락 거절을 위한 방법을 안내 받았는가	Y	\N	5	네 알겠습니다. 향후 연락 원치 않으시면 수신 거부 등록 도와드릴까요?
QA-20260308-0008	9	2. 방문판매모범규준	2	판매절차 적정성	카드 판매 인력의 소속과 성명을 안내 받았는가	N	카드 판매 인력의 성명 안내가 누락됨	1	안녕하세요 신한카드입니다.
QA-20260308-0008	10	2. 방문판매모범규준	3	판매절차 적정성	카드 판매 인력의 신원 확인이 가능함을 안내 받았는가	N	판매 인력 신원 확인 가능 여부 안내가 누락됨	1	안녕하세요 신한카드입니다.
QA-20260308-0008	11	3. 금융취약계층대상	1	설명의 의무	금융상품 판매 시 적정한 안내 속도로 판매되었는가	Y	\N	3	신상품 안내드리려고 연락드렸습니다.
QA-20260308-0008	12	3. 금융취약계층대상	2	설명의 의무	금융상품 판매 시 이용 동의 의사를 확인하며 강화된 권유 절차를 반영하였는가	Y	\N	7	처리해 드렸습니다. 좋은 하루 되십시오.
QA-20260308-0008	13	3. 금융취약계층대상	3	상품설명 이해여부 확인	금융상품 판매 시 중요사항과 유의사항에 대해 인지되도록 안내되었는가	Y	\N	3	신상품 안내드리려고 연락드렸습니다.
QA-20260308-0008	14	3. 금융취약계층대상	4	상품설명 이해여부 확인	판매하는 금융상품에 대한 상품·서비스에 대해 충분히 안내하고 인지 여부를 재확인하였는가	Y	\N	3	신상품 안내드리려고 연락드렸습니다.
QA-20260308-0008	15	4. 불완전판매개연성	1	상품설명 정확성&전달력	상담직원이 상품/서비스 판매 TM 목적에 대해 적합하게 안내하였는가	Y	\N	3	신상품 안내드리려고 연락드렸습니다.
QA-20260308-0008	16	4. 불완전판매개연성	2	상품설명 정확성&전달력	정확한 발음과 차분한 속도로 고객이 잘 들리도록 명확하게 안내하였는가	Y	\N	3	신상품 안내드리려고 연락드렸습니다.
QA-20260308-0008	17	4. 불완전판매개연성	3	상품설명 정확성&전달력	고객의 질의에 답변을 회피하거나 동문서답을 하였는가	Y	\N	5	네 알겠습니다. 향후 연락 원치 않으시면 수신 거부 등록 도와드릴까요?
QA-20260308-0008	18	4. 불완전판매개연성	4	상품설명 정확성&전달력	상품/서비스 내용 또는 제공되는 오퍼·혜택에 대해 오해의 소지가 없게 정확하게 안내하였는가	Y	\N	3	신상품 안내드리려고 연락드렸습니다.
QA-20260308-0008	20	4. 불완전판매개연성	6	상품설명 정확성&전달력	상품 가입/이용 선택에 필요한 위험요소, 주의사항, 유료화 여부 등에 대한 정보 전달이 정확한가	Y	\N	3	신상품 안내드리려고 연락드렸습니다.
\.


--
-- Data for Name: qa_consumer_eval_rows__sandbox_snapshot; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.qa_consumer_eval_rows__sandbox_snapshot ("ID", item_no, major_category, sub_no, criterion, item_text, yn, detail_text, evidence_line_no, evidence_text) FROM stdin;
QA-20260308-0008	19	4. 불완전판매개연성	5	상품설명 정확성&전달력	서비스 또는 판촉에 대한 오류 또는 미흡 안내로 추후 민원 소지 개연성이 있는가	Y	\N	3	신상품 안내드리려고 연락드렸습니다.
QA-20260308-0006	1	1. 금소법준수여부	1	고지의 의무	상담직원이 본인의 소속과 위임받은 사실 등을 고지하였는가	Y	\N	1	안녕하세요 신한카드 상품 안내 상담원 한지윤입니다. 본 통화는 품질 향상을 위해 녹취되고 있습니다.
QA-20260308-0006	2	1. 금소법준수여부	2	적합성원칙안내	연간소득과 신용점수 설문 시 특정 답변 유도 없이 안내 되었는가	Y	\N	5	감사합니다. 안내에 앞서 적합성 확인을 위해 연간 소득과 신용점수 구간을 여쭤보겠습니다.
QA-20260308-0006	3	1. 금소법준수여부	3	불공정 영업행위 금지	고객 동의 및 이해 부족임에도 상품 계약이 이뤄졌는가	Y	\N	9	지금까지 안내드린 내용에 이해되지 않으신 부분 있으실까요?
QA-20260308-0006	4	1. 금소법준수여부	4	부당권유 행위 금지	고객의 거절 의사 표명에도 마케팅 행위가 이뤄졌는가	Y	\N	3	오늘은 신용카드 신상품 더모아 카드 안내차 연락드렸습니다. 통화 가능하실까요?
QA-20260308-0006	5	1. 금소법준수여부	5	계약서류 제공 의무	상품안내장, 금소법설명서, 계약서, 핵심설명서 등 계약서류를 제공하였는가	Y	\N	11	감사합니다. 가입을 진행하시려면 이후 발송되는 상품안내장과 핵심설명서, 계약서류를 확인해 주신 뒤 동의 의사를 표시해 주시면 됩니다.
QA-20260308-0006	6	1. 금소법준수여부	6	상품설명 이해여부 확인	설명 이해 여부에 대해 상담직원이 물어보고 확인 받았는가 (고객 답변 확인 必)	Y	\N	9	지금까지 안내드린 내용에 이해되지 않으신 부분 있으실까요?
QA-20260308-0006	7	1. 금소법준수여부	7	불공정 영업행위 금지	금융상품판매업자 등이 우월적 지위를 이용하여 금융소비자의 의사에 반하여 권익을 침해하는 행위를 하였는가	Y	\N	7	감사합니다. 더모아 카드 핵심 혜택은 5천 원 미만 결제 시 잔돈을 포인트로 적립해 드리는 상품이고요, 연회비는 1만 5천 원입니다.
QA-20260308-0006	8	2. 방문판매모범규준	1	판매절차 적정성	전화 연락 거절을 위한 방법을 안내 받았는가	N	전화 연락 거절을 위한 별도 방법(수신 거부 절차 안내)이 통화 종료 직전에 안내되어 항목 충족 시점 기준 미충족	13	추가로 향후 연락을 원치 않으시면 1599-0000 으로 연락 주시면 수신 거부 처리해 드립니다. 좋은 하루 되십시오.
QA-20260308-0006	9	2. 방문판매모범규준	2	판매절차 적정성	카드 판매 인력의 소속과 성명을 안내 받았는가	Y	\N	1	안녕하세요 신한카드 상품 안내 상담원 한지윤입니다. 본 통화는 품질 향상을 위해 녹취되고 있습니다.
QA-20260308-0006	10	2. 방문판매모범규준	3	판매절차 적정성	카드 판매 인력의 신원 확인이 가능함을 안내 받았는가	Y	\N	1	안녕하세요 신한카드 상품 안내 상담원 한지윤입니다. 본 통화는 품질 향상을 위해 녹취되고 있습니다.
QA-20260308-0006	11	3. 금융취약계층대상	1	설명의 의무	금융상품 판매 시 적정한 안내 속도로 판매되었는가	Y	\N	7	감사합니다. 더모아 카드 핵심 혜택은 5천 원 미만 결제 시 잔돈을 포인트로 적립해 드리는 상품이고요, 연회비는 1만 5천 원입니다.
QA-20260308-0006	12	3. 금융취약계층대상	2	설명의 의무	금융상품 판매 시 이용 동의 의사를 확인하며 강화된 권유 절차를 반영하였는가	Y	\N	11	감사합니다. 가입을 진행하시려면 이후 발송되는 상품안내장과 핵심설명서, 계약서류를 확인해 주신 뒤 동의 의사를 표시해 주시면 됩니다.
QA-20260308-0006	13	3. 금융취약계층대상	3	상품설명 이해여부 확인	금융상품 판매 시 중요사항과 유의사항에 대해 인지되도록 안내되었는가	Y	\N	7	감사합니다. 더모아 카드 핵심 혜택은 5천 원 미만 결제 시 잔돈을 포인트로 적립해 드리는 상품이고요, 연회비는 1만 5천 원입니다.
QA-20260308-0006	14	3. 금융취약계층대상	4	상품설명 이해여부 확인	판매하는 금융상품에 대한 상품·서비스에 대해 충분히 안내하고 인지 여부를 재확인하였는가	Y	\N	9	지금까지 안내드린 내용에 이해되지 않으신 부분 있으실까요?
QA-20260308-0006	15	4. 불완전판매개연성	1	상품설명 정확성&전달력	상담직원이 상품/서비스 판매 TM 목적에 대해 적합하게 안내하였는가	Y	\N	3	오늘은 신용카드 신상품 더모아 카드 안내차 연락드렸습니다. 통화 가능하실까요?
QA-20260308-0006	16	4. 불완전판매개연성	2	상품설명 정확성&전달력	정확한 발음과 차분한 속도로 고객이 잘 들리도록 명확하게 안내하였는가	Y	\N	7	감사합니다. 더모아 카드 핵심 혜택은 5천 원 미만 결제 시 잔돈을 포인트로 적립해 드리는 상품이고요, 연회비는 1만 5천 원입니다.
QA-20260308-0006	17	4. 불완전판매개연성	3	상품설명 정확성&전달력	고객의 질의에 답변을 회피하거나 동문서답을 하였는가	Y	\N	9	지금까지 안내드린 내용에 이해되지 않으신 부분 있으실까요?
QA-20260308-0006	18	4. 불완전판매개연성	4	상품설명 정확성&전달력	상품/서비스 내용 또는 제공되는 오퍼·혜택에 대해 오해의 소지가 없게 정확하게 안내하였는가	Y	\N	7	감사합니다. 더모아 카드 핵심 혜택은 5천 원 미만 결제 시 잔돈을 포인트로 적립해 드리는 상품이고요, 연회비는 1만 5천 원입니다.
QA-20260308-0006	19	4. 불완전판매개연성	5	상품설명 정확성&전달력	서비스 또는 판촉에 대한 오류 또는 미흡 안내로 추후 민원 소지 개연성이 있는가	Y	\N	7	감사합니다. 더모아 카드 핵심 혜택은 5천 원 미만 결제 시 잔돈을 포인트로 적립해 드리는 상품이고요, 연회비는 1만 5천 원입니다.
QA-20260308-0008	5	1. 금소법준수여부	5	계약서류 제공 의무	상품안내장, 금소법설명서, 계약서, 핵심설명서 등 계약서류를 제공하였는가	N	상품안내장 및 계약서류 제공 절차가 통화 내 진행되지 않음	3	신상품 안내드리려고 연락드렸습니다.
QA-20260308-0006	20	4. 불완전판매개연성	6	상품설명 정확성&전달력	상품 가입/이용 선택에 필요한 위험요소, 주의사항, 유료화 여부 등에 대한 정보 전달이 정확한가	Y	\N	7	감사합니다. 더모아 카드 핵심 혜택은 5천 원 미만 결제 시 잔돈을 포인트로 적립해 드리는 상품이고요, 연회비는 1만 5천 원입니다.
QA-20260308-0007	1	1. 금소법준수여부	1	고지의 의무	상담직원이 본인의 소속과 위임받은 사실 등을 고지하였는가	Y	\N	3	신한카드 마케팅 안내차 연락드렸습니다. 신상품 추천드리려고요.
QA-20260308-0007	2	1. 금소법준수여부	2	적합성원칙안내	연간소득과 신용점수 설문 시 특정 답변 유도 없이 안내 되었는가	N	연간 소득과 신용점수 적합성 설문이 진행되지 않음	5	잠깐이면 됩니다. Mr.Life 카드 안내드릴게요. 이거 정말 좋습니다.
QA-20260308-0007	3	1. 금소법준수여부	3	불공정 영업행위 금지	고객 동의 및 이해 부족임에도 상품 계약이 이뤄졌는가	Y	\N	15	감사합니다 그러면 가입 처리 도와드리겠습니다.
QA-20260308-0007	4	1. 금소법준수여부	4	부당권유 행위 금지	고객의 거절 의사 표명에도 마케팅 행위가 이뤄졌는가	N	고객이 '거절하면 안 되나요'라고 의사 표명했음에도 추가 권유가 이어짐	13	한 번만 더 검토해 보세요. 정말 좋습니다.
QA-20260308-0007	5	1. 금소법준수여부	5	계약서류 제공 의무	상품안내장, 금소법설명서, 계약서, 핵심설명서 등 계약서류를 제공하였는가	Y	\N	15	감사합니다 그러면 가입 처리 도와드리겠습니다.
QA-20260308-0007	6	1. 금소법준수여부	6	상품설명 이해여부 확인	설명 이해 여부에 대해 상담직원이 물어보고 확인 받았는가 (고객 답변 확인 必)	N	이해 여부 질문 후 고객의 명시적 답변 확인이 이루어지지 않음	11	그건 약관봐 하시면 되고요, 일단 가입하시면 확인 가능합니다.
QA-20260308-0007	7	1. 금소법준수여부	7	불공정 영업행위 금지	금융상품판매업자 등이 우월적 지위를 이용하여 금융소비자의 의사에 반하여 권익을 침해하는 행위를 하였는가	Y	\N	13	한 번만 더 검토해 보세요. 정말 좋습니다.
QA-20260308-0007	8	2. 방문판매모범규준	1	판매절차 적정성	전화 연락 거절을 위한 방법을 안내 받았는가	N	수신 거부·연락 거절 방법에 대한 안내가 누락됨	15	감사합니다 그러면 가입 처리 도와드리겠습니다.
QA-20260308-0007	9	2. 방문판매모범규준	2	판매절차 적정성	카드 판매 인력의 소속과 성명을 안내 받았는가	Y	\N	3	신한카드 마케팅 안내차 연락드렸습니다. 신상품 추천드리려고요.
QA-20260308-0007	10	2. 방문판매모범규준	3	판매절차 적정성	카드 판매 인력의 신원 확인이 가능함을 안내 받았는가	Y	\N	3	신한카드 마케팅 안내차 연락드렸습니다. 신상품 추천드리려고요.
QA-20260308-0007	11	3. 금융취약계층대상	1	설명의 의무	금융상품 판매 시 적정한 안내 속도로 판매되었는가	Y	\N	5	잠깐이면 됩니다. Mr.Life 카드 안내드릴게요. 이거 정말 좋습니다.
QA-20260308-0007	12	3. 금융취약계층대상	2	설명의 의무	금융상품 판매 시 이용 동의 의사를 확인하며 강화된 권유 절차를 반영하였는가	Y	\N	15	감사합니다 그러면 가입 처리 도와드리겠습니다.
QA-20260308-0007	13	3. 금융취약계층대상	3	상품설명 이해여부 확인	금융상품 판매 시 중요사항과 유의사항에 대해 인지되도록 안내되었는가	Y	\N	7	고객님 같으신 분들은 누구나 무조건 가입하시는 상품이고요, 손해없음 보장입니다.
QA-20260308-0007	14	3. 금융취약계층대상	4	상품설명 이해여부 확인	판매하는 금융상품에 대한 상품·서비스에 대해 충분히 안내하고 인지 여부를 재확인하였는가	Y	\N	9	연회비는 거의무료 수준이에요. 자세한 건 나중에 안내드릴게요.
QA-20260308-0007	15	4. 불완전판매개연성	1	상품설명 정확성&전달력	상담직원이 상품/서비스 판매 TM 목적에 대해 적합하게 안내하였는가	Y	\N	3	신한카드 마케팅 안내차 연락드렸습니다. 신상품 추천드리려고요.
QA-20260308-0007	16	4. 불완전판매개연성	2	상품설명 정확성&전달력	정확한 발음과 차분한 속도로 고객이 잘 들리도록 명확하게 안내하였는가	Y	\N	5	잠깐이면 됩니다. Mr.Life 카드 안내드릴게요. 이거 정말 좋습니다.
QA-20260308-0007	17	4. 불완전판매개연성	3	상품설명 정확성&전달력	고객의 질의에 답변을 회피하거나 동문서답을 하였는가	N	연회비 등 고객 질의에 '약관에 다 나와 있다'며 회피성 답변을 함	11	그건 약관봐 하시면 되고요, 일단 가입하시면 확인 가능합니다.
QA-20260308-0007	18	4. 불완전판매개연성	4	상품설명 정확성&전달력	상품/서비스 내용 또는 제공되는 오퍼·혜택에 대해 오해의 소지가 없게 정확하게 안내하였는가	Y	\N	7	고객님 같으신 분들은 누구나 무조건 가입하시는 상품이고요, 손해없음 보장입니다.
QA-20260308-0007	19	4. 불완전판매개연성	5	상품설명 정확성&전달력	서비스 또는 판촉에 대한 오류 또는 미흡 안내로 추후 민원 소지 개연성이 있는가	Y	\N	5	잠깐이면 됩니다. Mr.Life 카드 안내드릴게요. 이거 정말 좋습니다.
QA-20260308-0007	20	4. 불완전판매개연성	6	상품설명 정확성&전달력	상품 가입/이용 선택에 필요한 위험요소, 주의사항, 유료화 여부 등에 대한 정보 전달이 정확한가	Y	\N	9	연회비는 거의무료 수준이에요. 자세한 건 나중에 안내드릴게요.
QA-20260308-0008	1	1. 금소법준수여부	1	고지의 의무	상담직원이 본인의 소속과 위임받은 사실 등을 고지하였는가	Y	\N	1	안녕하세요 신한카드입니다.
QA-20260308-0008	2	1. 금소법준수여부	2	적합성원칙안내	연간소득과 신용점수 설문 시 특정 답변 유도 없이 안내 되었는가	Y	\N	3	신상품 안내드리려고 연락드렸습니다.
QA-20260308-0008	3	1. 금소법준수여부	3	불공정 영업행위 금지	고객 동의 및 이해 부족임에도 상품 계약이 이뤄졌는가	Y	\N	5	네 알겠습니다. 향후 연락 원치 않으시면 수신 거부 등록 도와드릴까요?
QA-20260308-0008	4	1. 금소법준수여부	4	부당권유 행위 금지	고객의 거절 의사 표명에도 마케팅 행위가 이뤄졌는가	Y	\N	5	네 알겠습니다. 향후 연락 원치 않으시면 수신 거부 등록 도와드릴까요?
QA-20260308-0008	6	1. 금소법준수여부	6	상품설명 이해여부 확인	설명 이해 여부에 대해 상담직원이 물어보고 확인 받았는가 (고객 답변 확인 必)	Y	\N	5	네 알겠습니다. 향후 연락 원치 않으시면 수신 거부 등록 도와드릴까요?
QA-20260308-0008	7	1. 금소법준수여부	7	불공정 영업행위 금지	금융상품판매업자 등이 우월적 지위를 이용하여 금융소비자의 의사에 반하여 권익을 침해하는 행위를 하였는가	Y	\N	5	네 알겠습니다. 향후 연락 원치 않으시면 수신 거부 등록 도와드릴까요?
QA-20260308-0008	8	2. 방문판매모범규준	1	판매절차 적정성	전화 연락 거절을 위한 방법을 안내 받았는가	Y	\N	5	네 알겠습니다. 향후 연락 원치 않으시면 수신 거부 등록 도와드릴까요?
QA-20260308-0008	9	2. 방문판매모범규준	2	판매절차 적정성	카드 판매 인력의 소속과 성명을 안내 받았는가	N	카드 판매 인력의 성명 안내가 누락됨	1	안녕하세요 신한카드입니다.
QA-20260308-0008	10	2. 방문판매모범규준	3	판매절차 적정성	카드 판매 인력의 신원 확인이 가능함을 안내 받았는가	N	판매 인력 신원 확인 가능 여부 안내가 누락됨	1	안녕하세요 신한카드입니다.
QA-20260308-0008	11	3. 금융취약계층대상	1	설명의 의무	금융상품 판매 시 적정한 안내 속도로 판매되었는가	Y	\N	3	신상품 안내드리려고 연락드렸습니다.
QA-20260308-0008	12	3. 금융취약계층대상	2	설명의 의무	금융상품 판매 시 이용 동의 의사를 확인하며 강화된 권유 절차를 반영하였는가	Y	\N	7	처리해 드렸습니다. 좋은 하루 되십시오.
QA-20260308-0008	13	3. 금융취약계층대상	3	상품설명 이해여부 확인	금융상품 판매 시 중요사항과 유의사항에 대해 인지되도록 안내되었는가	Y	\N	3	신상품 안내드리려고 연락드렸습니다.
QA-20260308-0008	14	3. 금융취약계층대상	4	상품설명 이해여부 확인	판매하는 금융상품에 대한 상품·서비스에 대해 충분히 안내하고 인지 여부를 재확인하였는가	Y	\N	3	신상품 안내드리려고 연락드렸습니다.
QA-20260308-0008	15	4. 불완전판매개연성	1	상품설명 정확성&전달력	상담직원이 상품/서비스 판매 TM 목적에 대해 적합하게 안내하였는가	Y	\N	3	신상품 안내드리려고 연락드렸습니다.
QA-20260308-0008	16	4. 불완전판매개연성	2	상품설명 정확성&전달력	정확한 발음과 차분한 속도로 고객이 잘 들리도록 명확하게 안내하였는가	Y	\N	3	신상품 안내드리려고 연락드렸습니다.
QA-20260308-0008	17	4. 불완전판매개연성	3	상품설명 정확성&전달력	고객의 질의에 답변을 회피하거나 동문서답을 하였는가	Y	\N	5	네 알겠습니다. 향후 연락 원치 않으시면 수신 거부 등록 도와드릴까요?
QA-20260308-0008	18	4. 불완전판매개연성	4	상품설명 정확성&전달력	상품/서비스 내용 또는 제공되는 오퍼·혜택에 대해 오해의 소지가 없게 정확하게 안내하였는가	Y	\N	3	신상품 안내드리려고 연락드렸습니다.
QA-20260308-0008	20	4. 불완전판매개연성	6	상품설명 정확성&전달력	상품 가입/이용 선택에 필요한 위험요소, 주의사항, 유료화 여부 등에 대한 정보 전달이 정확한가	Y	\N	3	신상품 안내드리려고 연락드렸습니다.
\.


--
-- Data for Name: qa_consumer_keywords; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.qa_consumer_keywords (keyword_id, "ID", level, major_category, sub_category, keyword, line_no, line_text) FROM stdin;
6	QA-20260308-0007	Level 1 - 최고위험	허위·과장 광고	단정적 표현	누구나	7	고객님 같으신 분들은 누구나 무조건 가입하시는 상품이고요, 손해없음 보장입니다.
7	QA-20260308-0007	Level 1 - 최고위험	법적 리스크	강압적 표현	무조건	7	고객님 같으신 분들은 누구나 무조건 가입하시는 상품이고요, 손해없음 보장입니다.
8	QA-20260308-0007	Level 1 - 최고위험	허위·과장 광고	허위 안내	손해없음	7	고객님 같으신 분들은 누구나 무조건 가입하시는 상품이고요, 손해없음 보장입니다.
9	QA-20260308-0007	Level 3 - 중위험	연회비	조건 불명확	거의무료	9	연회비는 거의무료 수준이에요. 자세한 건 나중에 안내드릴게요.
10	QA-20260308-0007	Level 3 - 중위험	방어적 응대	불친절	약관봐	11	그건 약관봐 하시면 되고요, 일단 가입하시면 확인 가능합니다.
\.


--
-- Data for Name: qa_consumer_keywords__sandbox_snapshot; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.qa_consumer_keywords__sandbox_snapshot (keyword_id, "ID", level, major_category, sub_category, keyword, line_no, line_text) FROM stdin;
6	QA-20260308-0007	Level 1 - 최고위험	허위·과장 광고	단정적 표현	누구나	7	고객님 같으신 분들은 누구나 무조건 가입하시는 상품이고요, 손해없음 보장입니다.
7	QA-20260308-0007	Level 1 - 최고위험	법적 리스크	강압적 표현	무조건	7	고객님 같으신 분들은 누구나 무조건 가입하시는 상품이고요, 손해없음 보장입니다.
8	QA-20260308-0007	Level 1 - 최고위험	허위·과장 광고	허위 안내	손해없음	7	고객님 같으신 분들은 누구나 무조건 가입하시는 상품이고요, 손해없음 보장입니다.
9	QA-20260308-0007	Level 3 - 중위험	연회비	조건 불명확	거의무료	9	연회비는 거의무료 수준이에요. 자세한 건 나중에 안내드릴게요.
10	QA-20260308-0007	Level 3 - 중위험	방어적 응대	불친절	약관봐	11	그건 약관봐 하시면 되고요, 일단 가입하시면 확인 가능합니다.
\.


--
-- Data for Name: qa_call_transcript; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.qa_call_transcript ("ID", turn_no, speaker, text) FROM stdin;
QA-20260308-0001	1	상담사	안녕하세요 신한카드 컬렉션관리부 김민지 상담원입니다.
QA-20260308-0001	2	고객	네.
QA-20260308-0001	3	상담사	본인 확인을 위해 성함과 생년월일 부탁드립니다.
QA-20260308-0001	4	고객	이정훈, 1985년 7월 14일입니다.
QA-20260308-0001	5	상담사	확인 감사드립니다. 다름이 아니라 2월분 결제대금 87만 5천 원이 미납되어 안내드리려 연락드렸습니다.
QA-20260308-0001	6	고객	아 네, 알고 있어요. 이번 주 안에 입금하려고 했어요.
QA-20260308-0001	7	상담사	혹시 정확하게 어느 요일에 입금이 가능하실까요?
QA-20260308-0001	8	고객	금요일에 월급 들어오면 그때 처리할게요.
QA-20260308-0001	9	상담사	네 그럼 3월 13일 금요일로 메모해 두겠습니다. 입금 예정일에 미입금 시 다시 안내드릴 수 있습니다.
QA-20260308-0001	10	상담사	오늘 통화 감사드립니다. 좋은 하루 보내세요.
QA-20260308-0002	1	상담사	안녕하세요 신한카드 컬렉션관리부 박서연 상담원입니다.
QA-20260308-0002	2	고객	네 안녕하세요.
QA-20260308-0002	3	상담사	본인 확인을 위해 가입자 성함과 생년월일을 부탁드리겠습니다.
QA-20260308-0002	4	고객	최진호, 1978년 11월 3일입니다.
QA-20260308-0002	5	상담사	확인되셨습니다. 1월·2월 누적 연체금 142만 원에 대해 입금 일정 확인드리려 연락드렸습니다.
QA-20260308-0002	6	고객	지금 자금 사정이 좋지 않아서 분할이 가능한지 궁금합니다.
QA-20260308-0002	7	상담사	네 가능하시면 분할 안내 도와드리겠습니다. 우선 다음 주 화요일까지 70만 원 먼저 입금하시고 나머지 잔액은 4월 5일까지 처리하시는 안이 어떠실까요?
QA-20260308-0002	8	고객	그 정도면 가능할 것 같아요.
QA-20260308-0002	9	상담사	감사합니다. 약속 일자에 미입금 시 추가 연락이 발생할 수 있는 점 양해 부탁드립니다.
QA-20260308-0002	10	고객	네 알겠습니다.
QA-20260308-0002	11	상담사	약속 내용은 시스템에 등록해 두겠습니다. 좋은 하루 되십시오.
QA-20260308-0002	12	고객	감사합니다.
QA-20260308-0003	1	상담사	안녕하세요 신한카드 컬렉션관리부 이수빈 상담원입니다.
QA-20260308-0003	2	고객	네 말씀하세요.
QA-20260308-0003	3	상담사	본인 확인을 위해 성함과 생년월일을 말씀해 주시겠습니까?
QA-20260308-0003	4	고객	강민철, 1972년 4월 22일입니다.
QA-20260308-0003	5	상담사	확인되었습니다. 회원님 1월부터 누적된 카드 대금 318만 4천 원에 대해 입금 계획을 함께 정리해 드리려 연락드렸습니다.
QA-20260308-0003	6	고객	사실 사업이 어려워져서 한 번에 갚기는 힘들 것 같아요.
QA-20260308-0003	7	상담사	충분히 이해됩니다. 회원님 상황에 맞춰 분할 일정을 같이 검토해 드리겠습니다. 혹시 매달 가능한 금액 범위가 어느 정도이실까요?
QA-20260308-0003	8	고객	한 60만 원 정도면 무리 없이 가능할 것 같습니다.
QA-20260308-0003	9	상담사	감사합니다. 그러면 60만 원씩 6회 분할로 진행하시고, 첫 회 입금일은 3월 20일로 잡아 드릴까요?
QA-20260308-0003	10	고객	네 그렇게 하겠습니다.
QA-20260308-0003	11	상담사	네 약정 내용 다시 한번 확인드리겠습니다. 월 60만 원, 총 6회, 첫 회 3월 20일 입금. 맞으실까요?
QA-20260308-0003	12	고객	맞습니다.
QA-20260308-0003	13	상담사	감사합니다. 약정 내용은 시스템에 정확히 등록하고 안내 문자 발송 드리겠습니다.
QA-20260308-0003	14	상담사	오늘 시간 내주셔서 감사합니다. 건강하시고 좋은 하루 보내십시오.
QA-20260308-0004	1	상담사	여보세요 신한카드입니다.
QA-20260308-0004	2	고객	네 누구세요?
QA-20260308-0004	3	상담사	박지훈 회원님 되시죠?
QA-20260308-0004	4	고객	네 맞는데요.
QA-20260308-0004	5	상담사	카드 대금 미납 건으로 연락드렸어요.
QA-20260308-0004	6	고객	지금 바빠서 통화 어려운데요.
QA-20260308-0004	7	상담사	잠깐만 시간 좀 내주세요. 이번 주 안에 입금 가능하세요?
QA-20260308-0004	8	고객	글쎄요 노력은 해볼게요.
QA-20260308-0004	9	상담사	네 끊겠습니다.
QA-20260308-0005	1	상담사	안녕하세요 신한카드 고객센터 정유나 상담원입니다. 무엇을 도와드릴까요?
QA-20260308-0005	2	고객	안녕하세요. 제가 카드 대금이 일부 연체된 거 같아서 확인 좀 하려고요.
QA-20260308-0005	3	상담사	네 도와드리겠습니다. 본인 확인을 위해 성함과 생년월일 부탁드립니다.
QA-20260308-0005	4	고객	윤서영이고요 1990년 9월 18일입니다.
QA-20260308-0005	5	상담사	확인되셨습니다 회원님. 현재 2월분 결제대금 56만 2천 원이 미납 상태로 표시되고 있습니다.
QA-20260308-0005	6	고객	아 그렇군요. 오늘 바로 입금하면 추가 연체료는 어떻게 되나요?
QA-20260308-0005	7	상담사	오늘 영업시간 내 입금 처리되시면 추가 연체이자는 부과되지 않습니다. 가상계좌로 안내 드릴까요?
QA-20260308-0005	8	고객	네 부탁드립니다.
QA-20260308-0005	9	상담사	안내드린 가상계좌로 56만 2천 원 입금하시면 즉시 정상 처리됩니다. 처리 후 문자로 알림 받아보실 수 있습니다.
QA-20260308-0005	10	고객	감사합니다.
QA-20260308-0005	11	상담사	별말씀을요. 다른 문의 없으시면 좋은 하루 보내십시오.
QA-20260308-0006	1	상담사	안녕하세요 신한카드 상품 안내 상담원 한지윤입니다. 본 통화는 품질 향상을 위해 녹취되고 있습니다.
QA-20260308-0006	2	고객	네 안녕하세요.
QA-20260308-0006	3	상담사	오늘은 신용카드 신상품 더모아 카드 안내차 연락드렸습니다. 통화 가능하실까요?
QA-20260308-0006	4	고객	네 짧게 들어볼게요.
QA-20260308-0006	5	상담사	감사합니다. 안내에 앞서 적합성 확인을 위해 연간 소득과 신용점수 구간을 여쭤보겠습니다.
QA-20260308-0006	6	고객	연 소득 6천 정도, 신용점수는 800점 후반대입니다.
QA-20260308-0006	7	상담사	감사합니다. 더모아 카드 핵심 혜택은 5천 원 미만 결제 시 잔돈을 포인트로 적립해 드리는 상품이고요, 연회비는 1만 5천 원입니다.
QA-20260308-0006	8	고객	네 대략 이해했습니다.
QA-20260308-0006	9	상담사	지금까지 안내드린 내용에 이해되지 않으신 부분 있으실까요?
QA-20260308-0006	10	고객	아니요 충분히 설명해 주셔서 잘 이해했습니다.
QA-20260308-0006	11	상담사	감사합니다. 가입을 진행하시려면 이후 발송되는 상품안내장과 핵심설명서, 계약서류를 확인해 주신 뒤 동의 의사를 표시해 주시면 됩니다.
QA-20260308-0006	12	고객	네 검토해 보고 결정할게요.
QA-20260308-0006	13	상담사	감사합니다. 추가로 향후 연락을 원치 않으시면 1599-0000 으로 연락 주시면 수신 거부 처리해 드립니다. 좋은 하루 되십시오.
QA-20260308-0007	1	상담사	안녕하세요 카드 안내 드립니다.
QA-20260308-0007	2	고객	네 누구신가요?
QA-20260308-0007	3	상담사	신한카드 마케팅 안내차 연락드렸습니다. 신상품 추천드리려고요.
QA-20260308-0007	4	고객	지금 좀 바쁜데요.
QA-20260308-0007	5	상담사	잠깐이면 됩니다. Mr.Life 카드 안내드릴게요. 이거 정말 좋습니다.
QA-20260308-0007	6	고객	네 일단 듣겠습니다.
QA-20260308-0007	7	상담사	고객님 같으신 분들은 누구나 무조건 가입하시는 상품이고요, 손해없음 보장입니다.
QA-20260308-0007	8	고객	연회비는 얼마인가요?
QA-20260308-0007	9	상담사	연회비는 거의무료 수준이에요. 자세한 건 나중에 안내드릴게요.
QA-20260308-0007	10	고객	이해 안 가는데 좀 더 설명해 주실 수 있나요?
QA-20260308-0007	11	상담사	그건 약관봐 하시면 되고요, 일단 가입하시면 확인 가능합니다.
QA-20260308-0007	12	고객	잘 모르겠는데 거절하면 안 되나요?
QA-20260308-0007	13	상담사	한 번만 더 검토해 보세요. 정말 좋습니다.
QA-20260308-0007	14	고객	네... 알겠습니다.
QA-20260308-0007	15	상담사	감사합니다 그러면 가입 처리 도와드리겠습니다.
QA-20260308-0008	1	상담사	안녕하세요 신한카드입니다.
QA-20260308-0008	2	고객	네.
QA-20260308-0008	3	상담사	신상품 안내드리려고 연락드렸습니다.
QA-20260308-0008	4	고객	관심 없습니다.
QA-20260308-0008	5	상담사	네 알겠습니다. 향후 연락 원치 않으시면 수신 거부 등록 도와드릴까요?
QA-20260308-0008	6	고객	네 부탁드립니다.
QA-20260308-0008	7	상담사	처리해 드렸습니다. 좋은 하루 되십시오.
QA-20260308-0008	8	고객	네.
\.


--
-- Data for Name: qa_conversations__sandbox_snapshot; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.qa_conversations__sandbox_snapshot ("ID", turn_no, speaker, text) FROM stdin;
QA-20260308-0001	1	상담사	안녕하세요 신한카드 컬렉션관리부 김민지 상담원입니다.
QA-20260308-0001	2	고객	네.
QA-20260308-0001	3	상담사	본인 확인을 위해 성함과 생년월일 부탁드립니다.
QA-20260308-0001	4	고객	이정훈, 1985년 7월 14일입니다.
QA-20260308-0001	5	상담사	확인 감사드립니다. 다름이 아니라 2월분 결제대금 87만 5천 원이 미납되어 안내드리려 연락드렸습니다.
QA-20260308-0001	6	고객	아 네, 알고 있어요. 이번 주 안에 입금하려고 했어요.
QA-20260308-0001	7	상담사	혹시 정확하게 어느 요일에 입금이 가능하실까요?
QA-20260308-0001	8	고객	금요일에 월급 들어오면 그때 처리할게요.
QA-20260308-0001	9	상담사	네 그럼 3월 13일 금요일로 메모해 두겠습니다. 입금 예정일에 미입금 시 다시 안내드릴 수 있습니다.
QA-20260308-0001	10	상담사	오늘 통화 감사드립니다. 좋은 하루 보내세요.
QA-20260308-0002	1	상담사	안녕하세요 신한카드 컬렉션관리부 박서연 상담원입니다.
QA-20260308-0002	2	고객	네 안녕하세요.
QA-20260308-0002	3	상담사	본인 확인을 위해 가입자 성함과 생년월일을 부탁드리겠습니다.
QA-20260308-0002	4	고객	최진호, 1978년 11월 3일입니다.
QA-20260308-0002	5	상담사	확인되셨습니다. 1월·2월 누적 연체금 142만 원에 대해 입금 일정 확인드리려 연락드렸습니다.
QA-20260308-0002	6	고객	지금 자금 사정이 좋지 않아서 분할이 가능한지 궁금합니다.
QA-20260308-0002	7	상담사	네 가능하시면 분할 안내 도와드리겠습니다. 우선 다음 주 화요일까지 70만 원 먼저 입금하시고 나머지 잔액은 4월 5일까지 처리하시는 안이 어떠실까요?
QA-20260308-0002	8	고객	그 정도면 가능할 것 같아요.
QA-20260308-0002	9	상담사	감사합니다. 약속 일자에 미입금 시 추가 연락이 발생할 수 있는 점 양해 부탁드립니다.
QA-20260308-0002	10	고객	네 알겠습니다.
QA-20260308-0002	11	상담사	약속 내용은 시스템에 등록해 두겠습니다. 좋은 하루 되십시오.
QA-20260308-0002	12	고객	감사합니다.
QA-20260308-0003	1	상담사	안녕하세요 신한카드 컬렉션관리부 이수빈 상담원입니다.
QA-20260308-0003	2	고객	네 말씀하세요.
QA-20260308-0003	3	상담사	본인 확인을 위해 성함과 생년월일을 말씀해 주시겠습니까?
QA-20260308-0003	4	고객	강민철, 1972년 4월 22일입니다.
QA-20260308-0003	5	상담사	확인되었습니다. 회원님 1월부터 누적된 카드 대금 318만 4천 원에 대해 입금 계획을 함께 정리해 드리려 연락드렸습니다.
QA-20260308-0003	6	고객	사실 사업이 어려워져서 한 번에 갚기는 힘들 것 같아요.
QA-20260308-0003	7	상담사	충분히 이해됩니다. 회원님 상황에 맞춰 분할 일정을 같이 검토해 드리겠습니다. 혹시 매달 가능한 금액 범위가 어느 정도이실까요?
QA-20260308-0003	8	고객	한 60만 원 정도면 무리 없이 가능할 것 같습니다.
QA-20260308-0003	9	상담사	감사합니다. 그러면 60만 원씩 6회 분할로 진행하시고, 첫 회 입금일은 3월 20일로 잡아 드릴까요?
QA-20260308-0003	10	고객	네 그렇게 하겠습니다.
QA-20260308-0003	11	상담사	네 약정 내용 다시 한번 확인드리겠습니다. 월 60만 원, 총 6회, 첫 회 3월 20일 입금. 맞으실까요?
QA-20260308-0003	12	고객	맞습니다.
QA-20260308-0003	13	상담사	감사합니다. 약정 내용은 시스템에 정확히 등록하고 안내 문자 발송 드리겠습니다.
QA-20260308-0003	14	상담사	오늘 시간 내주셔서 감사합니다. 건강하시고 좋은 하루 보내십시오.
QA-20260308-0004	1	상담사	여보세요 신한카드입니다.
QA-20260308-0004	2	고객	네 누구세요?
QA-20260308-0004	3	상담사	박지훈 회원님 되시죠?
QA-20260308-0004	4	고객	네 맞는데요.
QA-20260308-0004	5	상담사	카드 대금 미납 건으로 연락드렸어요.
QA-20260308-0004	6	고객	지금 바빠서 통화 어려운데요.
QA-20260308-0004	7	상담사	잠깐만 시간 좀 내주세요. 이번 주 안에 입금 가능하세요?
QA-20260308-0004	8	고객	글쎄요 노력은 해볼게요.
QA-20260308-0004	9	상담사	네 끊겠습니다.
QA-20260308-0005	1	상담사	안녕하세요 신한카드 고객센터 정유나 상담원입니다. 무엇을 도와드릴까요?
QA-20260308-0005	2	고객	안녕하세요. 제가 카드 대금이 일부 연체된 거 같아서 확인 좀 하려고요.
QA-20260308-0005	3	상담사	네 도와드리겠습니다. 본인 확인을 위해 성함과 생년월일 부탁드립니다.
QA-20260308-0005	4	고객	윤서영이고요 1990년 9월 18일입니다.
QA-20260308-0005	5	상담사	확인되셨습니다 회원님. 현재 2월분 결제대금 56만 2천 원이 미납 상태로 표시되고 있습니다.
QA-20260308-0005	6	고객	아 그렇군요. 오늘 바로 입금하면 추가 연체료는 어떻게 되나요?
QA-20260308-0005	7	상담사	오늘 영업시간 내 입금 처리되시면 추가 연체이자는 부과되지 않습니다. 가상계좌로 안내 드릴까요?
QA-20260308-0005	8	고객	네 부탁드립니다.
QA-20260308-0005	9	상담사	안내드린 가상계좌로 56만 2천 원 입금하시면 즉시 정상 처리됩니다. 처리 후 문자로 알림 받아보실 수 있습니다.
QA-20260308-0005	10	고객	감사합니다.
QA-20260308-0005	11	상담사	별말씀을요. 다른 문의 없으시면 좋은 하루 보내십시오.
QA-20260308-0006	1	상담사	안녕하세요 신한카드 상품 안내 상담원 한지윤입니다. 본 통화는 품질 향상을 위해 녹취되고 있습니다.
QA-20260308-0006	2	고객	네 안녕하세요.
QA-20260308-0006	3	상담사	오늘은 신용카드 신상품 더모아 카드 안내차 연락드렸습니다. 통화 가능하실까요?
QA-20260308-0006	4	고객	네 짧게 들어볼게요.
QA-20260308-0006	5	상담사	감사합니다. 안내에 앞서 적합성 확인을 위해 연간 소득과 신용점수 구간을 여쭤보겠습니다.
QA-20260308-0006	6	고객	연 소득 6천 정도, 신용점수는 800점 후반대입니다.
QA-20260308-0006	7	상담사	감사합니다. 더모아 카드 핵심 혜택은 5천 원 미만 결제 시 잔돈을 포인트로 적립해 드리는 상품이고요, 연회비는 1만 5천 원입니다.
QA-20260308-0006	8	고객	네 대략 이해했습니다.
QA-20260308-0006	9	상담사	지금까지 안내드린 내용에 이해되지 않으신 부분 있으실까요?
QA-20260308-0006	10	고객	아니요 충분히 설명해 주셔서 잘 이해했습니다.
QA-20260308-0006	11	상담사	감사합니다. 가입을 진행하시려면 이후 발송되는 상품안내장과 핵심설명서, 계약서류를 확인해 주신 뒤 동의 의사를 표시해 주시면 됩니다.
QA-20260308-0006	12	고객	네 검토해 보고 결정할게요.
QA-20260308-0006	13	상담사	감사합니다. 추가로 향후 연락을 원치 않으시면 1599-0000 으로 연락 주시면 수신 거부 처리해 드립니다. 좋은 하루 되십시오.
QA-20260308-0007	1	상담사	안녕하세요 카드 안내 드립니다.
QA-20260308-0007	2	고객	네 누구신가요?
QA-20260308-0007	3	상담사	신한카드 마케팅 안내차 연락드렸습니다. 신상품 추천드리려고요.
QA-20260308-0007	4	고객	지금 좀 바쁜데요.
QA-20260308-0007	5	상담사	잠깐이면 됩니다. Mr.Life 카드 안내드릴게요. 이거 정말 좋습니다.
QA-20260308-0007	6	고객	네 일단 듣겠습니다.
QA-20260308-0007	7	상담사	고객님 같으신 분들은 누구나 무조건 가입하시는 상품이고요, 손해없음 보장입니다.
QA-20260308-0007	8	고객	연회비는 얼마인가요?
QA-20260308-0007	9	상담사	연회비는 거의무료 수준이에요. 자세한 건 나중에 안내드릴게요.
QA-20260308-0007	10	고객	이해 안 가는데 좀 더 설명해 주실 수 있나요?
QA-20260308-0007	11	상담사	그건 약관봐 하시면 되고요, 일단 가입하시면 확인 가능합니다.
QA-20260308-0007	12	고객	잘 모르겠는데 거절하면 안 되나요?
QA-20260308-0007	13	상담사	한 번만 더 검토해 보세요. 정말 좋습니다.
QA-20260308-0007	14	고객	네... 알겠습니다.
QA-20260308-0007	15	상담사	감사합니다 그러면 가입 처리 도와드리겠습니다.
QA-20260308-0008	1	상담사	안녕하세요 신한카드입니다.
QA-20260308-0008	2	고객	네.
QA-20260308-0008	3	상담사	신상품 안내드리려고 연락드렸습니다.
QA-20260308-0008	4	고객	관심 없습니다.
QA-20260308-0008	5	상담사	네 알겠습니다. 향후 연락 원치 않으시면 수신 거부 등록 도와드릴까요?
QA-20260308-0008	6	고객	네 부탁드립니다.
QA-20260308-0008	7	상담사	처리해 드렸습니다. 좋은 하루 되십시오.
QA-20260308-0008	8	고객	네.
\.


--
-- Data for Name: qa_call_item_score; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.qa_call_item_score ("ID", order_no, category, item, reason_text, ai_eval, manual_eval) FROM stdin;
QA-20260308-0001	1	친절도	인사말, 소속, 성명 모두 정확하게 시행	오프닝에서 신한카드 컬렉션관리부 소속과 성명을 명확히 고지함	3	3
QA-20260308-0001	2	친절도	본인 확인이 정확하게 이루어진 경우	성함과 생년월일을 통한 본인 확인 절차를 정상적으로 수행함	4	4
QA-20260308-0001	3	친절도	종료 인사 시행	종료 인사가 짧고 형식적이며 회원 호명이 누락됨	2	2
QA-20260308-0001	4	친절도	회원 상황에 맞는 속도와 적절한 음성 (일반적인 음성)	전반적으로 차분한 어조이나 일부 구간에서 속도가 빨라짐	4	4
QA-20260308-0001	5	친절도	상황에 맞는 고객 중심의 언어 사용	고객 중심 표현이 일부 사용되었으나 형식적인 응대가 섞여 있음	3	3
QA-20260308-0001	6	맞춤 응대 스킬	회원에 대한 경청, 공감 표현 및 호응도가 평이함	고객 발화에 대한 공감 표현이 제한적이고 질문 전환이 빠른 편	11	11
QA-20260308-0001	7	맞춤 응대 스킬	회원의 입금 계획을 이끌어내는 능력 및 대안제시가 일반적임	구체적 입금일 확인은 이루어졌으나 분할/대안 제시는 미흡	14	13
QA-20260308-0001	8	업무 정확도	회원의 요청사항 및 약속 건에 대한 정확하고 완벽한 업무 처리	약속 일자 메모는 진행되었으나 시스템 등록 멘트가 약함	14	14
QA-20260308-0001	9	사후 처리	정확하고 완벽한 사후처리 및 이력 등록	이력 등록 안내가 간략하게만 이뤄짐	7	7
QA-20260308-0002	1	친절도	인사말, 소속, 성명 모두 정확하게 시행	오프닝 인사·소속·성명을 모두 정확히 고지함	3	3
QA-20260308-0002	2	친절도	본인 확인이 정확하게 이루어진 경우	회원 본인 확인 절차를 표준 멘트로 시행함	4	4
QA-20260308-0002	3	친절도	종료 인사 시행	종료 인사를 정중하게 마무리하고 회원에게 인사함	3	3
QA-20260308-0002	4	친절도	회원 상황에 맞는 속도와 적절한 음성 (일반적인 음성)	차분한 속도로 안내가 이루어짐	4	4
QA-20260308-0002	5	친절도	상황에 맞는 고객 중심의 언어 사용	일부 표현이 다소 사무적이며 고객 입장 반영이 약함	2	2
QA-20260308-0002	6	맞춤 응대 스킬	회원에 대한 경청, 공감 표현 및 호응도가 평이함	고객의 자금 사정에 대한 공감을 표현하고 분할 제안으로 연결함	17	17
QA-20260308-0002	7	맞춤 응대 스킬	회원의 입금 계획을 이끌어내는 능력 및 대안제시가 일반적임	분할 일정 제시와 동의 확보가 자연스럽게 이루어짐	17	17
QA-20260308-0002	8	업무 정확도	회원의 요청사항 및 약속 건에 대한 정확하고 완벽한 업무 처리	약속 미이행 시 후속 안내 가능성을 고지함	17	17
QA-20260308-0002	9	사후 처리	정확하고 완벽한 사후처리 및 이력 등록	약속 내용을 시스템에 등록한다는 안내가 명확함	8	8
QA-20260308-0003	1	친절도	인사말, 소속, 성명 모두 정확하게 시행	신한카드 컬렉션관리부 소속과 성명을 정확히 고지함	3	3
QA-20260308-0003	2	친절도	본인 확인이 정확하게 이루어진 경우	표준 멘트로 본인 확인 절차를 정상 수행함	4	4
QA-20260308-0003	3	친절도	종료 인사 시행	회원에게 정중한 종료 인사로 마무리함	3	3
QA-20260308-0003	4	친절도	회원 상황에 맞는 속도와 적절한 음성 (일반적인 음성)	안정된 속도와 톤으로 회원 상황에 맞춰 안내함	4	4
QA-20260308-0003	5	친절도	상황에 맞는 고객 중심의 언어 사용	고객 입장에서 이해하기 쉬운 표현을 일관되게 사용함	10	10
QA-20260308-0003	6	맞춤 응대 스킬	회원에 대한 경청, 공감 표현 및 호응도가 평이함	사업 어려움에 공감을 표현하고 가능한 금액을 함께 정리함	9	10
QA-20260308-0003	7	맞춤 응대 스킬	회원의 입금 계획을 이끌어내는 능력 및 대안제시가 일반적임	분할 횟수와 첫 회 입금일을 구체적으로 합의함	19	19
QA-20260308-0003	8	업무 정확도	회원의 요청사항 및 약속 건에 대한 정확하고 완벽한 업무 처리	약정 내용을 재확인하여 회원 동의를 받음	19	19
QA-20260308-0003	9	사후 처리	정확하고 완벽한 사후처리 및 이력 등록	약정 내용을 시스템에 등록하고 안내 문자 발송을 안내함	10	10
QA-20260308-0004	1	친절도	인사말, 소속, 성명 모두 정확하게 시행	오프닝에서 소속만 언급되고 성명 고지가 누락됨	2	2
QA-20260308-0004	2	친절도	본인 확인이 정확하게 이루어진 경우	본인 여부 확인은 했으나 생년월일 등 추가 검증이 약함	3	3
QA-20260308-0004	3	친절도	종료 인사 시행	종료 인사가 매우 간략하고 회원 호명·감사 표현이 없음	2	2
QA-20260308-0004	4	친절도	회원 상황에 맞는 속도와 적절한 음성 (일반적인 음성)	다소 빠른 속도와 단조로운 어조로 안내됨	3	3
QA-20260308-0004	5	친절도	상황에 맞는 고객 중심의 언어 사용	일부 표현이 사무적이고 고객 중심 어휘가 부족함	6	6
QA-20260308-0004	6	맞춤 응대 스킬	회원에 대한 경청, 공감 표현 및 호응도가 평이함	고객의 바쁜 상황에 대한 공감 표현이 거의 없음	6	6
QA-20260308-0004	7	맞춤 응대 스킬	회원의 입금 계획을 이끌어내는 능력 및 대안제시가 일반적임	구체적 입금일이 합의되지 못하고 모호한 답변에 그침	12	12
QA-20260308-0004	8	업무 정확도	회원의 요청사항 및 약속 건에 대한 정확하고 완벽한 업무 처리	후속 약속 시스템 등록이 명확히 진행되지 않음	12	12
QA-20260308-0004	9	사후 처리	정확하고 완벽한 사후처리 및 이력 등록	이력 등록 멘트가 누락됨	6	6
QA-20260308-0005	1	친절도	인사말, 소속, 성명 모두 정확하게 시행	고객센터 소속과 성명을 명확히 안내함	5	5
QA-20260308-0005	2	친절도	본인 확인이 정확하게 이루어진 경우	본인 확인 절차를 표준대로 진행함	5	5
QA-20260308-0005	3	친절도	종료 인사 시행	종료 인사 시 후속 인사가 다소 짧음	4	4
QA-20260308-0005	4	친절도	회원 상황에 맞는 속도와 적절한 음성 (일반적인 음성)	차분한 속도와 안정된 음성으로 응대함	5	5
QA-20260308-0005	5	친절도	상황에 맞는 고객 중심의 언어 사용	고객 입장에서 이해하기 쉬운 표현을 사용함	9	9
QA-20260308-0005	6	맞춤 응대 스킬	회원에 대한 경청, 공감 표현 및 호응도가 평이함	고객 문의에 적극적으로 공감하며 가상계좌 안내로 즉시 연결함	17	18
QA-20260308-0005	7	맞춤 응대 스킬	회원의 입금 계획을 이끌어내는 능력 및 대안제시가 일반적임	추가 연체이자 안내 등 정확한 정보를 제공함	13	13
QA-20260308-0005	8	업무 정확도	회원의 요청사항 및 약속 건에 대한 정확하고 완벽한 업무 처리	가상계좌와 처리 알림 안내가 정확함	12	12
QA-20260308-0005	9	사후 처리	정확하고 완벽한 사후처리 및 이력 등록	처리 완료 후 알림 문자 발송 안내가 포함됨	9	9
\.


--
-- Data for Name: qa_evaluation_rows__sandbox_snapshot; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.qa_evaluation_rows__sandbox_snapshot ("ID", order_no, category, item, reason_text, ai_eval, manual_eval) FROM stdin;
QA-20260308-0001	1	친절도	인사말, 소속, 성명 모두 정확하게 시행	오프닝에서 신한카드 컬렉션관리부 소속과 성명을 명확히 고지함	3	3
QA-20260308-0001	2	친절도	본인 확인이 정확하게 이루어진 경우	성함과 생년월일을 통한 본인 확인 절차를 정상적으로 수행함	4	4
QA-20260308-0001	3	친절도	종료 인사 시행	종료 인사가 짧고 형식적이며 회원 호명이 누락됨	2	2
QA-20260308-0001	4	친절도	회원 상황에 맞는 속도와 적절한 음성 (일반적인 음성)	전반적으로 차분한 어조이나 일부 구간에서 속도가 빨라짐	4	4
QA-20260308-0001	5	친절도	상황에 맞는 고객 중심의 언어 사용	고객 중심 표현이 일부 사용되었으나 형식적인 응대가 섞여 있음	3	3
QA-20260308-0001	6	맞춤 응대 스킬	회원에 대한 경청, 공감 표현 및 호응도가 평이함	고객 발화에 대한 공감 표현이 제한적이고 질문 전환이 빠른 편	11	11
QA-20260308-0001	7	맞춤 응대 스킬	회원의 입금 계획을 이끌어내는 능력 및 대안제시가 일반적임	구체적 입금일 확인은 이루어졌으나 분할/대안 제시는 미흡	14	13
QA-20260308-0001	8	업무 정확도	회원의 요청사항 및 약속 건에 대한 정확하고 완벽한 업무 처리	약속 일자 메모는 진행되었으나 시스템 등록 멘트가 약함	14	14
QA-20260308-0001	9	사후 처리	정확하고 완벽한 사후처리 및 이력 등록	이력 등록 안내가 간략하게만 이뤄짐	7	7
QA-20260308-0002	1	친절도	인사말, 소속, 성명 모두 정확하게 시행	오프닝 인사·소속·성명을 모두 정확히 고지함	3	3
QA-20260308-0002	2	친절도	본인 확인이 정확하게 이루어진 경우	회원 본인 확인 절차를 표준 멘트로 시행함	4	4
QA-20260308-0002	3	친절도	종료 인사 시행	종료 인사를 정중하게 마무리하고 회원에게 인사함	3	3
QA-20260308-0002	4	친절도	회원 상황에 맞는 속도와 적절한 음성 (일반적인 음성)	차분한 속도로 안내가 이루어짐	4	4
QA-20260308-0002	5	친절도	상황에 맞는 고객 중심의 언어 사용	일부 표현이 다소 사무적이며 고객 입장 반영이 약함	2	2
QA-20260308-0002	6	맞춤 응대 스킬	회원에 대한 경청, 공감 표현 및 호응도가 평이함	고객의 자금 사정에 대한 공감을 표현하고 분할 제안으로 연결함	17	17
QA-20260308-0002	7	맞춤 응대 스킬	회원의 입금 계획을 이끌어내는 능력 및 대안제시가 일반적임	분할 일정 제시와 동의 확보가 자연스럽게 이루어짐	17	17
QA-20260308-0002	8	업무 정확도	회원의 요청사항 및 약속 건에 대한 정확하고 완벽한 업무 처리	약속 미이행 시 후속 안내 가능성을 고지함	17	17
QA-20260308-0002	9	사후 처리	정확하고 완벽한 사후처리 및 이력 등록	약속 내용을 시스템에 등록한다는 안내가 명확함	8	8
QA-20260308-0003	1	친절도	인사말, 소속, 성명 모두 정확하게 시행	신한카드 컬렉션관리부 소속과 성명을 정확히 고지함	3	3
QA-20260308-0003	2	친절도	본인 확인이 정확하게 이루어진 경우	표준 멘트로 본인 확인 절차를 정상 수행함	4	4
QA-20260308-0003	3	친절도	종료 인사 시행	회원에게 정중한 종료 인사로 마무리함	3	3
QA-20260308-0003	4	친절도	회원 상황에 맞는 속도와 적절한 음성 (일반적인 음성)	안정된 속도와 톤으로 회원 상황에 맞춰 안내함	4	4
QA-20260308-0003	5	친절도	상황에 맞는 고객 중심의 언어 사용	고객 입장에서 이해하기 쉬운 표현을 일관되게 사용함	10	10
QA-20260308-0003	6	맞춤 응대 스킬	회원에 대한 경청, 공감 표현 및 호응도가 평이함	사업 어려움에 공감을 표현하고 가능한 금액을 함께 정리함	9	10
QA-20260308-0003	7	맞춤 응대 스킬	회원의 입금 계획을 이끌어내는 능력 및 대안제시가 일반적임	분할 횟수와 첫 회 입금일을 구체적으로 합의함	19	19
QA-20260308-0003	8	업무 정확도	회원의 요청사항 및 약속 건에 대한 정확하고 완벽한 업무 처리	약정 내용을 재확인하여 회원 동의를 받음	19	19
QA-20260308-0003	9	사후 처리	정확하고 완벽한 사후처리 및 이력 등록	약정 내용을 시스템에 등록하고 안내 문자 발송을 안내함	10	10
QA-20260308-0004	1	친절도	인사말, 소속, 성명 모두 정확하게 시행	오프닝에서 소속만 언급되고 성명 고지가 누락됨	2	2
QA-20260308-0004	2	친절도	본인 확인이 정확하게 이루어진 경우	본인 여부 확인은 했으나 생년월일 등 추가 검증이 약함	3	3
QA-20260308-0004	3	친절도	종료 인사 시행	종료 인사가 매우 간략하고 회원 호명·감사 표현이 없음	2	2
QA-20260308-0004	4	친절도	회원 상황에 맞는 속도와 적절한 음성 (일반적인 음성)	다소 빠른 속도와 단조로운 어조로 안내됨	3	3
QA-20260308-0004	5	친절도	상황에 맞는 고객 중심의 언어 사용	일부 표현이 사무적이고 고객 중심 어휘가 부족함	6	6
QA-20260308-0004	6	맞춤 응대 스킬	회원에 대한 경청, 공감 표현 및 호응도가 평이함	고객의 바쁜 상황에 대한 공감 표현이 거의 없음	6	6
QA-20260308-0004	7	맞춤 응대 스킬	회원의 입금 계획을 이끌어내는 능력 및 대안제시가 일반적임	구체적 입금일이 합의되지 못하고 모호한 답변에 그침	12	12
QA-20260308-0004	8	업무 정확도	회원의 요청사항 및 약속 건에 대한 정확하고 완벽한 업무 처리	후속 약속 시스템 등록이 명확히 진행되지 않음	12	12
QA-20260308-0004	9	사후 처리	정확하고 완벽한 사후처리 및 이력 등록	이력 등록 멘트가 누락됨	6	6
QA-20260308-0005	1	친절도	인사말, 소속, 성명 모두 정확하게 시행	고객센터 소속과 성명을 명확히 안내함	5	5
QA-20260308-0005	2	친절도	본인 확인이 정확하게 이루어진 경우	본인 확인 절차를 표준대로 진행함	5	5
QA-20260308-0005	3	친절도	종료 인사 시행	종료 인사 시 후속 인사가 다소 짧음	4	4
QA-20260308-0005	4	친절도	회원 상황에 맞는 속도와 적절한 음성 (일반적인 음성)	차분한 속도와 안정된 음성으로 응대함	5	5
QA-20260308-0005	5	친절도	상황에 맞는 고객 중심의 언어 사용	고객 입장에서 이해하기 쉬운 표현을 사용함	9	9
QA-20260308-0005	6	맞춤 응대 스킬	회원에 대한 경청, 공감 표현 및 호응도가 평이함	고객 문의에 적극적으로 공감하며 가상계좌 안내로 즉시 연결함	17	18
QA-20260308-0005	7	맞춤 응대 스킬	회원의 입금 계획을 이끌어내는 능력 및 대안제시가 일반적임	추가 연체이자 안내 등 정확한 정보를 제공함	13	13
QA-20260308-0005	8	업무 정확도	회원의 요청사항 및 약속 건에 대한 정확하고 완벽한 업무 처리	가상계좌와 처리 알림 안내가 정확함	12	12
QA-20260308-0005	9	사후 처리	정확하고 완벽한 사후처리 및 이력 등록	처리 완료 후 알림 문자 발송 안내가 포함됨	9	9
\.


--
-- Name: admin_users_user_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.admin_users_user_id_seq', 56, true);


--
-- Name: qa_audit_logs_audit_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.qa_audit_logs_audit_id_seq', 19, true);


--
-- Name: qa_consumer_keywords_keyword_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.qa_consumer_keywords_keyword_id_seq', 10, true);


--
-- Name: admin_users admin_users_login_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_users
    ADD CONSTRAINT admin_users_login_id_key UNIQUE (login_id);


--
-- Name: admin_users admin_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_users
    ADD CONSTRAINT admin_users_pkey PRIMARY KEY (user_id);


--
-- Name: qa_call_pentagon_result qa_analysis_report_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qa_call_pentagon_result
    ADD CONSTRAINT qa_analysis_report_pkey PRIMARY KEY ("ID", item_type_no);


--
-- Name: qa_audit_logs qa_audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qa_audit_logs
    ADD CONSTRAINT qa_audit_logs_pkey PRIMARY KEY (audit_id);


--
-- Name: qa_calls qa_calls_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qa_calls
    ADD CONSTRAINT qa_calls_pkey PRIMARY KEY ("ID");


--
-- Name: qa_call_item_evidence qa_checklist_rows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qa_call_item_evidence
    ADD CONSTRAINT qa_checklist_rows_pkey PRIMARY KEY ("ID", order_no);


--
-- Name: qa_consumer_ai_categories qa_consumer_ai_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qa_consumer_ai_categories
    ADD CONSTRAINT qa_consumer_ai_categories_pkey PRIMARY KEY ("ID", category_no);


--
-- Name: qa_consumer_eval_rows qa_consumer_eval_rows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qa_consumer_eval_rows
    ADD CONSTRAINT qa_consumer_eval_rows_pkey PRIMARY KEY ("ID", item_no);


--
-- Name: qa_consumer_keywords qa_consumer_keywords_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qa_consumer_keywords
    ADD CONSTRAINT qa_consumer_keywords_pkey PRIMARY KEY (keyword_id);


--
-- Name: qa_call_transcript qa_conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qa_call_transcript
    ADD CONSTRAINT qa_conversations_pkey PRIMARY KEY ("ID", turn_no);


--
-- Name: qa_call_item_score qa_evaluation_rows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qa_call_item_score
    ADD CONSTRAINT qa_evaluation_rows_pkey PRIMARY KEY ("ID", order_no);


--
-- Name: idx_qa_audit_action; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qa_audit_action ON public.qa_audit_logs USING btree (action, created_at DESC);


--
-- Name: idx_qa_audit_actor_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qa_audit_actor_time ON public.qa_audit_logs USING btree (actor_login_id, created_at DESC);


--
-- Name: idx_qa_audit_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qa_audit_created ON public.qa_audit_logs USING btree (created_at DESC);


--
-- Name: idx_qa_audit_resource; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qa_audit_resource ON public.qa_audit_logs USING btree (resource_type, resource_id);


--
-- Name: idx_qa_consumer_keywords_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qa_consumer_keywords_id ON public.qa_consumer_keywords USING btree ("ID");


--
-- Name: qa_call_pentagon_result qa_analysis_report_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qa_call_pentagon_result
    ADD CONSTRAINT "qa_analysis_report_ID_fkey" FOREIGN KEY ("ID") REFERENCES public.qa_calls("ID") ON DELETE CASCADE;


--
-- Name: qa_call_item_evidence qa_checklist_rows_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qa_call_item_evidence
    ADD CONSTRAINT "qa_checklist_rows_ID_fkey" FOREIGN KEY ("ID") REFERENCES public.qa_calls("ID") ON DELETE CASCADE;


--
-- Name: qa_consumer_ai_categories qa_consumer_ai_categories_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qa_consumer_ai_categories
    ADD CONSTRAINT "qa_consumer_ai_categories_ID_fkey" FOREIGN KEY ("ID") REFERENCES public.qa_calls("ID") ON DELETE CASCADE;


--
-- Name: qa_consumer_eval_rows qa_consumer_eval_rows_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qa_consumer_eval_rows
    ADD CONSTRAINT "qa_consumer_eval_rows_ID_fkey" FOREIGN KEY ("ID") REFERENCES public.qa_calls("ID") ON DELETE CASCADE;


--
-- Name: qa_consumer_keywords qa_consumer_keywords_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qa_consumer_keywords
    ADD CONSTRAINT "qa_consumer_keywords_ID_fkey" FOREIGN KEY ("ID") REFERENCES public.qa_calls("ID") ON DELETE CASCADE;


--
-- Name: qa_call_transcript qa_conversations_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qa_call_transcript
    ADD CONSTRAINT "qa_conversations_ID_fkey" FOREIGN KEY ("ID") REFERENCES public.qa_calls("ID") ON DELETE CASCADE;


--
-- Name: qa_call_item_score qa_evaluation_rows_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qa_call_item_score
    ADD CONSTRAINT "qa_evaluation_rows_ID_fkey" FOREIGN KEY ("ID") REFERENCES public.qa_calls("ID") ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict Da37lSJRWnAhT90DhJGUuUnsCc6YGzvHOgaGEmUyVCFkCQ9qkez6QgabPGS6Nba

