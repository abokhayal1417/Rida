-- التقييم الذكي حسب المنصب | Smart Position-Based Evaluation
-- Non-destructive: if an evaluations table already exists, columns are added to it.

-- ---------- criteria ----------
create table if not exists public.evaluation_criteria (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name_ar text not null,
  name_en text,
  -- null = applies to every target; otherwise only to these position codes
  position_codes text[],
  sort int not null default 0,
  active boolean not null default true
);

insert into public.evaluation_criteria (code, name_ar, name_en, position_codes, sort) values
  ('professionalism',     'المهنية',              'Professionalism',        null, 10),
  ('communication',       'التواصل',              'Communication',          null, 20),
  ('responsiveness',      'سرعة الاستجابة',        'Responsiveness',         null, 30),
  ('service_quality',     'جودة الخدمة',           'Quality of service',     null, 40),
  ('problem_solving',     'حل المشكلات',           'Problem-solving',        null, 50),
  ('respectful_treatment','التعامل باحترام',       'Respectful treatment',   null, 60),
  ('explanation_clarity', 'وضوح الشرح',            'Clarity of teaching',    array['teacher'], 70),
  ('student_followup',    'متابعة مستوى الطالب',    'Following student progress', array['teacher','academic_supervisor'], 80),
  ('confidentiality',     'الحفاظ على الخصوصية',    'Confidentiality',        array['student_counselor'], 90),
  ('punctuality',         'الالتزام بالمواعيد',      'Punctuality',            array['transport_supervisor'], 100),
  ('safety',              'السلامة',               'Safety',                 array['transport_supervisor'], 110),
  ('decision_fairness',   'عدالة القرارات',         'Fairness of decisions',  array['principal','vice_principal'], 120),
  ('procedure_clarity',   'وضوح الإجراءات',         'Clarity of procedures',  array['admissions_officer'], 130),
  ('activity_quality',    'جودة الأنشطة',           'Quality of activities',  array['activities_coordinator'], 140)
on conflict (code) do nothing;

-- ---------- evaluations ----------
create sequence if not exists public.evaluation_ref_seq;

create table if not exists public.evaluations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

alter table public.evaluations
  add column if not exists reference_no text,
  add column if not exists school_id uuid references public.schools(id),
  add column if not exists parent_id uuid references public.profiles(id),
  add column if not exists anonymous_submission boolean not null default false,
  add column if not exists evaluation_target_type text,
  add column if not exists selected_stage_id uuid references public.school_stages(id),
  add column if not exists selected_department_id uuid references public.departments(id),
  add column if not exists selected_position_id uuid references public.positions(id),
  add column if not exists selected_grade_id uuid references public.grades(id),
  add column if not exists selected_class_id uuid references public.classes(id),
  add column if not exists selected_subject_id uuid references public.subjects(id),
  add column if not exists matched_employee_id uuid references public.employees(id),
  add column if not exists suggested_employee_ids uuid[] not null default '{}',
  add column if not exists employee_matching_status text,
  add column if not exists employee_matching_method text,
  add column if not exists matching_reviewed_by uuid references public.profiles(id),
  add column if not exists matching_reviewed_at timestamptz,
  add column if not exists evaluation_context jsonb not null default '{}',
  add column if not exists incident_date date,
  add column if not exists overall_satisfaction smallint,
  add column if not exists comments text,
  add column if not exists suggested_improvements text,
  add column if not exists is_negative boolean not null default false,
  add column if not exists follow_up_requested boolean not null default false,
  add column if not exists contact_name text,
  add column if not exists contact_phone text,
  add column if not exists contact_email text,
  add column if not exists review_state text not null default 'open',
  add column if not exists review_outcome text,
  add column if not exists ai_classification jsonb,
  add column if not exists updated_at timestamptz not null default now();

-- Constraints added only if missing (keeps re-runs and existing tables safe).
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'evaluations_target_type_chk') then
    alter table public.evaluations add constraint evaluations_target_type_chk
      check (evaluation_target_type is null or evaluation_target_type in ('position','employee','department')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'evaluations_matching_status_chk') then
    alter table public.evaluations add constraint evaluations_matching_status_chk
      check (employee_matching_status is null or employee_matching_status in
             ('matched','ambiguous','unmatched','pending_review','manually_verified')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'evaluations_matching_method_chk') then
    alter table public.evaluations add constraint evaluations_matching_method_chk
      check (employee_matching_method is null or employee_matching_method in
             ('auto_unique_assignment','parent_selected_by_name','manual_quality_review','none')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'evaluations_review_state_chk') then
    alter table public.evaluations add constraint evaluations_review_state_chk
      check (review_state in ('open','clarification_requested','reviewed')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'evaluations_overall_chk') then
    alter table public.evaluations add constraint evaluations_overall_chk
      check (overall_satisfaction is null or overall_satisfaction between 1 and 5) not valid;
  end if;
  -- A verified/matched link must point at an employee; review statuses must not.
  if not exists (select 1 from pg_constraint where conname = 'evaluations_match_consistency_chk') then
    alter table public.evaluations add constraint evaluations_match_consistency_chk
      check (
        (employee_matching_status in ('matched','manually_verified') and matched_employee_id is not null)
        or (employee_matching_status is distinct from 'matched'
            and employee_matching_status is distinct from 'manually_verified'
            and matched_employee_id is null)
      ) not valid;
  end if;
  -- Anonymous submissions carry no parent link and no contact details.
  if not exists (select 1 from pg_constraint where conname = 'evaluations_anonymous_chk') then
    alter table public.evaluations add constraint evaluations_anonymous_chk
      check (not anonymous_submission or (parent_id is null and not follow_up_requested
             and contact_phone is null and contact_email is null and contact_name is null)) not valid;
  end if;
end $$;

create unique index if not exists evaluations_reference_uidx on public.evaluations(reference_no);
create index if not exists evaluations_school_status_idx on public.evaluations(school_id, employee_matching_status, review_state);
create index if not exists evaluations_position_idx on public.evaluations(selected_position_id);
create index if not exists evaluations_department_idx on public.evaluations(selected_department_id);
create index if not exists evaluations_matched_employee_idx on public.evaluations(matched_employee_id);
create index if not exists evaluations_parent_idx on public.evaluations(parent_id);
create index if not exists evaluations_created_idx on public.evaluations(school_id, created_at);

create table if not exists public.evaluation_scores (
  evaluation_id uuid not null references public.evaluations(id) on delete cascade,
  criterion_id uuid not null references public.evaluation_criteria(id),
  score smallint not null check (score between 1 and 5),
  primary key (evaluation_id, criterion_id)
);

create table if not exists public.evaluation_messages (
  id uuid primary key default gen_random_uuid(),
  evaluation_id uuid not null references public.evaluations(id) on delete cascade,
  author_id uuid references public.profiles(id),
  author_role text not null check (author_role in ('parent','reviewer')),
  body text not null check (length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists evaluation_messages_eval_idx on public.evaluation_messages(evaluation_id);

-- Append-only audit trail. No update/delete grants or policies exist.
create table if not exists public.evaluation_audit_log (
  id bigserial primary key,
  evaluation_id uuid not null references public.evaluations(id) on delete cascade,
  actor_id uuid references public.profiles(id),
  action text not null,
  before jsonb,
  after jsonb,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists evaluation_audit_eval_idx on public.evaluation_audit_log(evaluation_id);

-- Per-user daily counter for abuse limits; stores counts, never which evaluation.
create table if not exists private.submission_counter (
  user_id uuid not null,
  day date not null,
  n int not null default 0,
  primary key (user_id, day)
);

-- ---------- matching ----------
-- Candidates: active employees holding the position on the incident date whose
-- assignment is compatible with every context value the parent gave.
-- A null on the assignment means "covers all"; a null from the parent means "not given".
create or replace function private.match_candidates(
  p_school uuid, p_position uuid, p_stage uuid, p_grade uuid, p_class uuid,
  p_subject uuid, p_date date
) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct e.id order by e.id), '{}')
  from public.employee_assignments a
  join public.employees e on e.id = a.employee_id
  where e.school_id = p_school and e.active
    and a.position_id = p_position
    and a.effective_from <= p_date
    and (a.effective_to is null or a.effective_to >= p_date)
    and (a.stage_id   is null or p_stage   is null or a.stage_id   = p_stage)
    and (a.grade_id   is null or p_grade   is null or a.grade_id   = p_grade)
    and (a.class_id   is null or p_class   is null or a.class_id   = p_class)
    and (a.subject_id is null or p_subject is null or a.subject_id = p_subject)
$$;

-- Returns {status, employee_id, candidates, needs}.
-- needs = context fields the parent has not given that would separate the candidates.
create or replace function private.match_employee(
  p_school uuid, p_position uuid, p_stage uuid, p_grade uuid, p_class uuid,
  p_subject uuid, p_date date
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  c uuid[];
  needs text[] := '{}';
  f text;
begin
  c := private.match_candidates(p_school, p_position, p_stage, p_grade, p_class, p_subject, p_date);
  if cardinality(c) = 0 then
    return jsonb_build_object('status','unmatched','employee_id',null,'candidates','[]'::jsonb,'needs','[]'::jsonb);
  elsif cardinality(c) = 1 then
    return jsonb_build_object('status','matched','employee_id',c[1],'candidates',to_jsonb(c),'needs','[]'::jsonb);
  end if;

  -- Which missing fields actually differ across the candidates' assignments?
  foreach f in array array['stage','grade','class','subject'] loop
    if (f = 'stage' and p_stage is null) or (f = 'grade' and p_grade is null)
       or (f = 'class' and p_class is null) or (f = 'subject' and p_subject is null) then
      if (select count(distinct case f when 'stage' then a.stage_id when 'grade' then a.grade_id
                                         when 'class' then a.class_id else a.subject_id end)
          from public.employee_assignments a
          where a.employee_id = any(c) and a.position_id = p_position
            and a.effective_from <= p_date and (a.effective_to is null or a.effective_to >= p_date)
            and (a.stage_id   is null or p_stage   is null or a.stage_id   = p_stage)
            and (a.grade_id   is null or p_grade   is null or a.grade_id   = p_grade)
            and (a.class_id   is null or p_class   is null or a.class_id   = p_class)
            and (a.subject_id is null or p_subject is null or a.subject_id = p_subject)) > 1
      then
        needs := needs || f;
      end if;
    end if;
  end loop;

  return jsonb_build_object('status','ambiguous','employee_id',null,
                            'candidates',to_jsonb(c),'needs',to_jsonb(needs));
end $$;

-- ---------- validation helper ----------
create or replace function private.validate_context(
  p_school uuid, p_stage uuid, p_department uuid, p_position uuid,
  p_grade uuid, p_class uuid, p_subject uuid
) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_stage is not null and not exists (select 1 from public.school_stages where id = p_stage and school_id = p_school) then
    raise exception 'invalid_stage' using errcode = '22023';
  end if;
  if p_department is not null and not exists (select 1 from public.departments where id = p_department and school_id = p_school and active) then
    raise exception 'invalid_department' using errcode = '22023';
  end if;
  if p_position is not null and not exists (
      select 1 from public.positions where id = p_position and school_id = p_school and active
        and (p_department is null or department_id = p_department)) then
    raise exception 'invalid_position' using errcode = '22023';
  end if;
  if p_grade is not null and not exists (
      select 1 from public.grades g join public.school_stages s on s.id = g.stage_id
      where g.id = p_grade and s.school_id = p_school and (p_stage is null or g.stage_id = p_stage)) then
    raise exception 'invalid_grade' using errcode = '22023';
  end if;
  if p_class is not null and not exists (
      select 1 from public.classes c join public.grades g on g.id = c.grade_id
      join public.school_stages s on s.id = g.stage_id
      where c.id = p_class and s.school_id = p_school and (p_grade is null or c.grade_id = p_grade)) then
    raise exception 'invalid_class' using errcode = '22023';
  end if;
  if p_subject is not null and not exists (select 1 from public.subjects where id = p_subject and school_id = p_school) then
    raise exception 'invalid_subject' using errcode = '22023';
  end if;
end $$;

-- ---------- parent-facing RPCs ----------
create or replace function private.require_parent() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare s uuid;
begin
  select school_id into s from public.profiles where id = auth.uid() and role = 'parent';
  if s is null then raise exception 'not_authorized' using errcode = '42501'; end if;
  return s;
end $$;

-- Lets the wizard know whether more context is needed. Never returns employee ids or names.
create or replace function private.preview_match(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  s uuid := private.require_parent();
  r jsonb;
begin
  perform private.validate_context(s, (p->>'stage_id')::uuid, (p->>'department_id')::uuid,
    (p->>'position_id')::uuid, (p->>'grade_id')::uuid, (p->>'class_id')::uuid, (p->>'subject_id')::uuid);
  r := private.match_employee(s, (p->>'position_id')::uuid, (p->>'stage_id')::uuid,
    (p->>'grade_id')::uuid, (p->>'class_id')::uuid, (p->>'subject_id')::uuid,
    coalesce((p->>'incident_date')::date, current_date));
  return jsonb_build_object('status', r->'status', 'needs', r->'needs');
end $$;

-- Name search for "evaluate by employee name": names and position titles only.
create or replace function private.search_employees(q text)
returns table (id uuid, full_name_ar text, positions text)
language plpgsql stable security definer set search_path = '' as $$
declare
  s uuid := private.require_parent();
  term text := replace(replace(replace(trim(coalesce(q,'')), '%', ''), '_', ''), '\', '');
begin
  -- Wildcards stripped first, so "%%" cannot list the whole staff directory.
  if length(term) < 2 then return; end if;
  return query
    select e.id, e.full_name_ar,
           string_agg(distinct p.name_ar, '، ')
    from public.employees e
    left join public.employee_assignments a on a.employee_id = e.id
      and a.effective_from <= current_date and (a.effective_to is null or a.effective_to >= current_date)
    left join public.positions p on p.id = a.position_id
    where e.school_id = s and e.active
      and e.full_name_ar ilike '%' || term || '%'
    group by e.id, e.full_name_ar
    order by e.full_name_ar
    limit 20;
end $$;

create or replace function private.submit_evaluation(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s uuid := private.require_parent();
  sch public.schools;
  v_target text := p->>'target_type';
  v_stage uuid := (p->>'stage_id')::uuid;
  v_dept uuid := (p->>'department_id')::uuid;
  v_pos uuid := (p->>'position_id')::uuid;
  v_grade uuid := (p->>'grade_id')::uuid;
  v_class uuid := (p->>'class_id')::uuid;
  v_subject uuid := (p->>'subject_id')::uuid;
  v_emp uuid := (p->>'employee_id')::uuid;
  v_date date := coalesce((p->>'incident_date')::date, current_date);
  v_anon boolean := coalesce((p->>'anonymous')::boolean, false);
  v_follow boolean := coalesce((p->>'follow_up')::boolean, false);
  v_overall int := (p->>'overall_satisfaction')::int;
  v_pos_row public.positions;
  v_match jsonb;
  v_status text;
  v_method text;
  v_matched uuid;
  v_suggested uuid[] := '{}';
  v_negative boolean;
  v_id uuid;
  v_ref text;
  k text;
  v_score int;
  v_crit public.evaluation_criteria;
  v_count int;
begin
  select * into sch from public.schools where id = s;

  -- abuse limit: 10 submissions per user per day (counted, not linked)
  insert into private.submission_counter as sc (user_id, day, n) values (auth.uid(), current_date, 1)
    on conflict (user_id, day) do update set n = sc.n + 1
    returning n into v_count;
  if v_count > 10 then raise exception 'daily_limit_reached' using errcode = '54000'; end if;

  if v_target not in ('position','employee','department') then
    raise exception 'invalid_target_type' using errcode = '22023';
  end if;
  if v_overall is null or v_overall not between 1 and 5 then
    raise exception 'overall_required' using errcode = '22023';
  end if;
  if v_date > current_date or v_date < current_date - 365 then
    raise exception 'invalid_incident_date' using errcode = '22023';
  end if;
  if v_anon and not sch.allow_anonymous then
    raise exception 'anonymous_not_allowed' using errcode = '22023';
  end if;
  if v_anon and v_follow then
    raise exception 'follow_up_requires_identity' using errcode = '22023';
  end if;
  if v_follow and coalesce(nullif(trim(p->>'contact_phone'),''), nullif(trim(p->>'contact_email'),'')) is null then
    raise exception 'follow_up_requires_contact' using errcode = '22023';
  end if;

  perform private.validate_context(s, v_stage, v_dept, v_pos, v_grade, v_class, v_subject);

  if v_target = 'position' then
    if v_pos is null then raise exception 'position_required' using errcode = '22023'; end if;
    select * into v_pos_row from public.positions where id = v_pos;
    v_dept := v_pos_row.department_id;
    if v_pos_row.requires_subject_and_class and (v_subject is null or v_class is null) then
      raise exception 'subject_and_class_required' using errcode = '22023';
    end if;
  elsif v_target = 'employee' then
    if v_emp is null or not exists (select 1 from public.employees where id = v_emp and school_id = s and active) then
      raise exception 'invalid_employee' using errcode = '22023';
    end if;
  else
    if v_dept is null then raise exception 'department_required' using errcode = '22023'; end if;
    v_pos := null;
  end if;

  -- scores: only criteria that apply to this target
  for k in select jsonb_object_keys(coalesce(p->'scores','{}'::jsonb)) loop
    select * into v_crit from public.evaluation_criteria c
      where c.code = k and c.active
        and (c.position_codes is null or (v_pos_row.code is not null and v_pos_row.code = any(c.position_codes)));
    if v_crit.id is null then raise exception 'invalid_criterion:%', k using errcode = '22023'; end if;
    v_score := (p->'scores'->>k)::int;
    if v_score not between 1 and 5 then raise exception 'invalid_score' using errcode = '22023'; end if;
  end loop;

  select v_overall <= 2 or exists (
    select 1 from jsonb_each_text(coalesce(p->'scores','{}'::jsonb)) e where e.value::int <= 2)
  into v_negative;

  -- matching
  if v_target = 'position' then
    v_match := private.match_employee(s, v_pos, v_stage, v_grade, v_class, v_subject, v_date);
    select coalesce(array_agg(x::uuid), '{}') into v_suggested
      from jsonb_array_elements_text(v_match->'candidates') x;
    if v_match->>'status' = 'matched' then
      if v_negative and sch.negative_requires_review then
        -- unique by assignment data, but negative: a reviewer confirms before it touches anyone's record
        v_status := 'pending_review'; v_method := 'auto_unique_assignment'; v_matched := null;
      else
        v_status := 'matched'; v_method := 'auto_unique_assignment';
        v_matched := (v_match->>'employee_id')::uuid;
      end if;
    elsif v_match->>'status' = 'ambiguous' then
      v_status := 'ambiguous'; v_method := 'none';
    else
      v_status := 'unmatched'; v_method := 'none';
    end if;
  elsif v_target = 'employee' then
    v_suggested := array[v_emp];
    if v_negative and sch.negative_requires_review then
      v_status := 'pending_review'; v_method := 'parent_selected_by_name';
    else
      v_status := 'matched'; v_method := 'parent_selected_by_name'; v_matched := v_emp;
    end if;
  else
    v_status := null; v_method := null; -- department-level, not about one person
  end if;

  v_ref := 'RIDA-' || to_char(current_date, 'YY') || '-' || lpad(nextval('public.evaluation_ref_seq')::text, 6, '0');

  insert into public.evaluations (
    reference_no, school_id, parent_id, anonymous_submission, evaluation_target_type,
    selected_stage_id, selected_department_id, selected_position_id, selected_grade_id,
    selected_class_id, selected_subject_id, matched_employee_id, suggested_employee_ids,
    employee_matching_status, employee_matching_method, evaluation_context, incident_date,
    overall_satisfaction, comments, suggested_improvements, is_negative,
    follow_up_requested, contact_name, contact_phone, contact_email)
  values (
    v_ref, s, case when v_anon then null else auth.uid() end, v_anon, v_target,
    v_stage, v_dept, v_pos, v_grade, v_class, v_subject, v_matched, v_suggested,
    v_status, v_method,
    jsonb_build_object('matcher_version', 1, 'needs_at_submit', coalesce(v_match->'needs','[]'::jsonb),
                       'candidate_count', cardinality(v_suggested)),
    v_date, v_overall,
    nullif(left(trim(p->>'comments'), 4000), ''),
    nullif(left(trim(p->>'suggested_improvements'), 4000), ''),
    v_negative, v_follow,
    case when v_follow then nullif(left(trim(p->>'contact_name'),200),'') end,
    case when v_follow then nullif(left(trim(p->>'contact_phone'),40),'') end,
    case when v_follow then nullif(left(trim(p->>'contact_email'),200),'') end)
  returning id into v_id;

  insert into public.evaluation_scores (evaluation_id, criterion_id, score)
  select v_id, c.id, (p->'scores'->>c.code)::int
  from public.evaluation_criteria c
  where p->'scores' ? c.code;

  insert into public.evaluation_audit_log (evaluation_id, actor_id, action, after)
  values (v_id, case when v_anon then null else auth.uid() end, 'submitted',
          jsonb_build_object('employee_matching_status', v_status, 'employee_matching_method', v_method,
                             'matched_employee_id', v_matched, 'candidate_count', cardinality(v_suggested)));

  return jsonb_build_object('reference_no', v_ref, 'status', v_status);
end $$;

create or replace function private.parent_reply(p_eval uuid, p_body text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_parent();
  if not exists (select 1 from public.evaluations where id = p_eval and parent_id = auth.uid()
                 and review_state = 'clarification_requested') then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  insert into public.evaluation_messages (evaluation_id, author_id, author_role, body)
  values (p_eval, auth.uid(), 'parent', trim(p_body));
  update public.evaluations set review_state = 'open', updated_at = now() where id = p_eval;
  insert into public.evaluation_audit_log (evaluation_id, actor_id, action, note)
  values (p_eval, auth.uid(), 'parent_replied', null);
end $$;

-- ---------- reviewer RPCs ----------
create or replace function private.require_reviewer(p_eval uuid) returns public.evaluations
language plpgsql stable security definer set search_path = '' as $$
declare e public.evaluations;
begin
  if not private.is_staff_reviewer() then raise exception 'not_authorized' using errcode = '42501'; end if;
  select * into e from public.evaluations where id = p_eval and school_id = private.my_school();
  if e.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  return e;
end $$;

create or replace function private.snapshot(e public.evaluations) returns jsonb
language sql immutable as $$
  select jsonb_build_object('matched_employee_id', e.matched_employee_id,
    'employee_matching_status', e.employee_matching_status,
    'employee_matching_method', e.employee_matching_method,
    'review_state', e.review_state, 'review_outcome', e.review_outcome)
$$;

-- Confirm or correct the employee link.
create or replace function private.review_set_employee(p_eval uuid, p_employee uuid, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare e public.evaluations := private.require_reviewer(p_eval);
        a public.evaluations;
begin
  if not exists (select 1 from public.employees where id = p_employee and school_id = e.school_id) then
    raise exception 'invalid_employee' using errcode = '22023';
  end if;
  update public.evaluations set matched_employee_id = p_employee,
    employee_matching_status = 'manually_verified', employee_matching_method = 'manual_quality_review',
    matching_reviewed_by = auth.uid(), matching_reviewed_at = now(),
    review_state = 'reviewed', review_outcome = 'employee_linked', updated_at = now()
  where id = p_eval returning * into a;
  insert into public.evaluation_audit_log (evaluation_id, actor_id, action, before, after, note)
  values (p_eval, auth.uid(),
          case when e.matched_employee_id is not null and e.matched_employee_id <> p_employee
               then 'match_corrected' else 'match_confirmed' end,
          private.snapshot(e), private.snapshot(a), nullif(trim(p_note),''));
end $$;

create or replace function private.review_keep_department(p_eval uuid, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare e public.evaluations := private.require_reviewer(p_eval);
        a public.evaluations;
begin
  update public.evaluations set matched_employee_id = null,
    employee_matching_status = case when evaluation_target_type = 'department' then null else 'unmatched' end,
    employee_matching_method = case when evaluation_target_type = 'department' then null else 'manual_quality_review' end,
    matching_reviewed_by = auth.uid(), matching_reviewed_at = now(),
    review_state = 'reviewed', review_outcome = 'department_level', updated_at = now()
  where id = p_eval returning * into a;
  insert into public.evaluation_audit_log (evaluation_id, actor_id, action, before, after, note)
  values (p_eval, auth.uid(), 'kept_department_level', private.snapshot(e), private.snapshot(a), nullif(trim(p_note),''));
end $$;

create or replace function private.review_request_clarification(p_eval uuid, p_message text)
returns void language plpgsql security definer set search_path = '' as $$
declare e public.evaluations := private.require_reviewer(p_eval);
begin
  if e.parent_id is null then raise exception 'anonymous_cannot_be_contacted' using errcode = '22023'; end if;
  if p_message is null or length(trim(p_message)) = 0 then raise exception 'message_required' using errcode = '22023'; end if;
  insert into public.evaluation_messages (evaluation_id, author_id, author_role, body)
  values (p_eval, auth.uid(), 'reviewer', trim(p_message));
  update public.evaluations set review_state = 'clarification_requested', updated_at = now() where id = p_eval;
  insert into public.evaluation_audit_log (evaluation_id, actor_id, action, before, after, note)
  values (p_eval, auth.uid(), 'clarification_requested', private.snapshot(e),
          private.snapshot(e) || jsonb_build_object('review_state','clarification_requested'), trim(p_message));
end $$;

create or replace function private.review_mark_reviewed(p_eval uuid, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare e public.evaluations := private.require_reviewer(p_eval);
        a public.evaluations;
begin
  update public.evaluations set review_state = 'reviewed',
    review_outcome = coalesce(review_outcome, 'reviewed_no_change'), updated_at = now()
  where id = p_eval returning * into a;
  insert into public.evaluation_audit_log (evaluation_id, actor_id, action, before, after, note)
  values (p_eval, auth.uid(), 'marked_reviewed', private.snapshot(e), private.snapshot(a), nullif(trim(p_note),''));
end $$;

-- AI output is stored as a suggestion only. It never touches matched_employee_id.
create or replace function private.review_save_ai(p_eval uuid, p_ai jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare e public.evaluations := private.require_reviewer(p_eval);
begin
  update public.evaluations set ai_classification = p_ai || jsonb_build_object('generated_at', now()),
    updated_at = now() where id = p_eval;
  insert into public.evaluation_audit_log (evaluation_id, actor_id, action, after)
  values (p_eval, auth.uid(), 'ai_suggestion_saved', p_ai);
end $$;

-- ---------- public wrappers (SECURITY INVOKER; PostgREST exposes only these) ----------
create or replace function public.preview_match(p jsonb) returns jsonb
language sql security invoker as $$ select private.preview_match(p) $$;
create or replace function public.search_employees(q text)
returns table (id uuid, full_name_ar text, positions text)
language sql security invoker as $$ select * from private.search_employees(q) $$;
create or replace function public.submit_evaluation(p jsonb) returns jsonb
language sql security invoker as $$ select private.submit_evaluation(p) $$;
create or replace function public.parent_reply(p_eval uuid, p_body text) returns void
language sql security invoker as $$ select private.parent_reply(p_eval, p_body) $$;
create or replace function public.review_set_employee(p_eval uuid, p_employee uuid, p_note text default null) returns void
language sql security invoker as $$ select private.review_set_employee(p_eval, p_employee, p_note) $$;
create or replace function public.review_keep_department(p_eval uuid, p_note text default null) returns void
language sql security invoker as $$ select private.review_keep_department(p_eval, p_note) $$;
create or replace function public.review_request_clarification(p_eval uuid, p_message text) returns void
language sql security invoker as $$ select private.review_request_clarification(p_eval, p_message) $$;
create or replace function public.review_mark_reviewed(p_eval uuid, p_note text default null) returns void
language sql security invoker as $$ select private.review_mark_reviewed(p_eval, p_note) $$;
create or replace function public.review_save_ai(p_eval uuid, p_ai jsonb) returns void
language sql security invoker as $$ select private.review_save_ai(p_eval, p_ai) $$;

-- Lock down function execution: nothing for anon, explicit grants for authenticated.
revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;
revoke execute on function private.match_candidates(uuid,uuid,uuid,uuid,uuid,uuid,date),
  private.match_employee(uuid,uuid,uuid,uuid,uuid,uuid,date) from authenticated;
-- match_* are called from inside definer functions (owner privileges), never directly.

revoke execute on function public.preview_match(jsonb), public.search_employees(text),
  public.submit_evaluation(jsonb), public.parent_reply(uuid,text),
  public.review_set_employee(uuid,uuid,text), public.review_keep_department(uuid,text),
  public.review_request_clarification(uuid,text), public.review_mark_reviewed(uuid,text),
  public.review_save_ai(uuid,jsonb) from public, anon;
grant execute on function public.preview_match(jsonb), public.search_employees(text),
  public.submit_evaluation(jsonb), public.parent_reply(uuid,text),
  public.review_set_employee(uuid,uuid,text), public.review_keep_department(uuid,text),
  public.review_request_clarification(uuid,text), public.review_mark_reviewed(uuid,text),
  public.review_save_ai(uuid,jsonb) to authenticated;

-- ---------- RLS ----------
alter table public.evaluation_criteria enable row level security;
alter table public.evaluations enable row level security;
alter table public.evaluation_scores enable row level security;
alter table public.evaluation_messages enable row level security;
alter table public.evaluation_audit_log enable row level security;

drop policy if exists criteria_read on public.evaluation_criteria;
create policy criteria_read on public.evaluation_criteria for select to authenticated using (active);

drop policy if exists evaluations_parent_read on public.evaluations;
create policy evaluations_parent_read on public.evaluations for select to authenticated
  using (parent_id = auth.uid());
drop policy if exists evaluations_reviewer_read on public.evaluations;
create policy evaluations_reviewer_read on public.evaluations for select to authenticated
  using (school_id = private.my_school() and private.is_staff_reviewer());

drop policy if exists scores_read on public.evaluation_scores;
create policy scores_read on public.evaluation_scores for select to authenticated
  using (exists (select 1 from public.evaluations e where e.id = evaluation_id));

drop policy if exists messages_read on public.evaluation_messages;
create policy messages_read on public.evaluation_messages for select to authenticated
  using (exists (select 1 from public.evaluations e where e.id = evaluation_id));

drop policy if exists audit_reviewer_read on public.evaluation_audit_log;
create policy audit_reviewer_read on public.evaluation_audit_log for select to authenticated
  using (private.is_staff_reviewer() and exists (
    select 1 from public.evaluations e where e.id = evaluation_id and e.school_id = private.my_school()));

-- All writes go through the RPCs above.
revoke insert, update, delete on public.evaluations, public.evaluation_scores,
  public.evaluation_messages, public.evaluation_audit_log, public.evaluation_criteria from authenticated, anon;
grant select on public.evaluations, public.evaluation_scores, public.evaluation_messages,
  public.evaluation_audit_log, public.evaluation_criteria to authenticated;

-- ---------- analytics views (security_invoker: RLS of the viewer applies) ----------
create or replace view public.v_review_queue with (security_invoker = true) as
select e.id, e.reference_no, e.school_id, e.created_at, e.incident_date,
       e.evaluation_target_type, e.employee_matching_status, e.employee_matching_method,
       e.review_state, e.is_negative, e.overall_satisfaction, e.anonymous_submission,
       e.follow_up_requested, cardinality(e.suggested_employee_ids) as candidate_count,
       d.name_ar as department_name, p.name_ar as position_name, st.name_ar as stage_name,
       g.name_ar as grade_name, c.name_ar as class_name, sb.name_ar as subject_name,
       left(e.comments, 200) as comments_preview
from public.evaluations e
left join public.departments d on d.id = e.selected_department_id
left join public.positions p on p.id = e.selected_position_id
left join public.school_stages st on st.id = e.selected_stage_id
left join public.grades g on g.id = e.selected_grade_id
left join public.classes c on c.id = e.selected_class_id
left join public.subjects sb on sb.id = e.selected_subject_id
where e.review_state <> 'reviewed'
  and (e.employee_matching_status in ('ambiguous','unmatched','pending_review')
       or e.review_state = 'clarification_requested');

create or replace view public.v_eval_by_position with (security_invoker = true) as
select e.school_id, p.id as position_id, p.name_ar as position_name,
       count(*) as total, round(avg(e.overall_satisfaction)::numeric, 2) as avg_overall,
       count(*) filter (where e.is_negative) as negative_count
from public.evaluations e join public.positions p on p.id = e.selected_position_id
group by e.school_id, p.id, p.name_ar;

create or replace view public.v_eval_by_department with (security_invoker = true) as
select e.school_id, d.id as department_id, d.name_ar as department_name,
       count(*) as total, round(avg(e.overall_satisfaction)::numeric, 2) as avg_overall,
       count(*) filter (where e.is_negative) as negative_count
from public.evaluations e join public.departments d on d.id = e.selected_department_id
group by e.school_id, d.id, d.name_ar;

create or replace view public.v_eval_status_summary with (security_invoker = true) as
select e.school_id,
  count(*) as total,
  count(*) filter (where e.employee_matching_status in ('matched','manually_verified')) as linked_verified,
  count(*) filter (where e.employee_matching_status = 'unmatched') as unmatched,
  count(*) filter (where e.employee_matching_status = 'ambiguous') as ambiguous,
  count(*) filter (where e.review_state <> 'reviewed' and (e.employee_matching_status in ('ambiguous','unmatched','pending_review')
                   or e.review_state = 'clarification_requested')) as awaiting_review,
  count(*) filter (where e.evaluation_target_type = 'department') as department_level
from public.evaluations e group by e.school_id;

create or replace view public.v_satisfaction_trend with (security_invoker = true) as
select e.school_id, date_trunc('month', e.created_at)::date as month,
       p.id as position_id, p.name_ar as position_name,
       count(*) as total, round(avg(e.overall_satisfaction)::numeric, 2) as avg_overall
from public.evaluations e join public.positions p on p.id = e.selected_position_id
group by e.school_id, 2, p.id, p.name_ar;

-- Recurring complaints: 3+ negative evaluations for a position in 90 days.
create or replace view public.v_recurring_complaints with (security_invoker = true) as
select e.school_id, p.id as position_id, p.name_ar as position_name,
       count(*) as negative_90d,
       mode() within group (order by e.ai_classification->>'category') as top_ai_category
from public.evaluations e join public.positions p on p.id = e.selected_position_id
where e.is_negative and e.created_at >= now() - interval '90 days'
group by e.school_id, p.id, p.name_ar
having count(*) >= 3;

-- Individual performance: ONLY verified employee links count.
create or replace view public.v_employee_performance with (security_invoker = true) as
select e.school_id, em.id as employee_id, em.full_name_ar,
       count(*) as total, round(avg(e.overall_satisfaction)::numeric, 2) as avg_overall,
       count(*) filter (where e.is_negative) as negative_count
from public.evaluations e join public.employees em on em.id = e.matched_employee_id
where e.employee_matching_status in ('matched','manually_verified')
group by e.school_id, em.id, em.full_name_ar;

grant select on public.v_review_queue, public.v_eval_by_position, public.v_eval_by_department,
  public.v_eval_status_summary, public.v_satisfaction_trend, public.v_recurring_complaints,
  public.v_employee_performance to authenticated;
revoke all on public.v_review_queue, public.v_eval_by_position, public.v_eval_by_department,
  public.v_eval_status_summary, public.v_satisfaction_trend, public.v_recurring_complaints,
  public.v_employee_performance from anon;

-- Reviewers see names of people in their school (identified parents, other reviewers in the audit log).
drop policy if exists profiles_reviewer_read on public.profiles;
create policy profiles_reviewer_read on public.profiles for select to authenticated
  using (school_id = private.my_school() and private.is_staff_reviewer());
