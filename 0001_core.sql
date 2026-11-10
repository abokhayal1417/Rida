-- RIDA core schema: schools, stages, grades, classes, subjects,
-- departments, positions, employees, assignments, profiles, students.
-- Non-destructive: every object uses IF NOT EXISTS, safe to re-run.

create extension if not exists pgcrypto;

create schema if not exists private;
grant usage on schema private to authenticated;

-- ---------- reference data ----------
create table if not exists public.schools (
  id uuid primary key default gen_random_uuid(),
  name_ar text not null,
  name_en text,
  allow_anonymous boolean not null default true,
  -- negative feedback with only automatic matching evidence goes to review first
  negative_requires_review boolean not null default true,
  created_at timestamptz not null default now()
);
-- Parents join their school with this code at sign-up. Rotate it from SQL if leaked.
alter table public.schools add column if not exists join_code text;
create unique index if not exists schools_join_code_uidx on public.schools(join_code);

create table if not exists public.school_stages (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  name_ar text not null,
  name_en text,
  sort int not null default 0
);
create index if not exists school_stages_school_idx on public.school_stages(school_id);

create table if not exists public.grades (
  id uuid primary key default gen_random_uuid(),
  stage_id uuid not null references public.school_stages(id) on delete cascade,
  name_ar text not null,
  sort int not null default 0
);
create index if not exists grades_stage_idx on public.grades(stage_id);

create table if not exists public.classes (
  id uuid primary key default gen_random_uuid(),
  grade_id uuid not null references public.grades(id) on delete cascade,
  name_ar text not null
);
create index if not exists classes_grade_idx on public.classes(grade_id);

create table if not exists public.subjects (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  name_ar text not null,
  name_en text
);
create index if not exists subjects_school_idx on public.subjects(school_id);

create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  code text not null,
  name_ar text not null,
  name_en text,
  sort int not null default 0,
  active boolean not null default true,
  unique (school_id, code)
);

create table if not exists public.positions (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  department_id uuid not null references public.departments(id) on delete restrict,
  code text not null,
  name_ar text not null,
  name_en text,
  -- teacher-like positions: parent must give subject + grade/class
  requires_subject_and_class boolean not null default false,
  sort int not null default 0,
  active boolean not null default true,
  unique (school_id, code)
);
create index if not exists positions_department_idx on public.positions(department_id);

-- ---------- people ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  school_id uuid references public.schools(id),
  role text not null default 'parent'
    check (role in ('parent','employee','quality_manager','school_admin')),
  full_name text,
  created_at timestamptz not null default now()
);

-- Public-facing employee record: name + status only. Nothing confidential here.
create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  full_name_ar text not null,
  full_name_en text,
  profile_id uuid references public.profiles(id),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists employees_school_idx on public.employees(school_id);

-- Confidential employee data lives apart; only school admins can read it.
create table if not exists public.employee_private (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  email text,
  phone text,
  hr_notes text
);

create table if not exists public.employee_assignments (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  position_id uuid not null references public.positions(id) on delete restrict,
  -- null = applies to every value (e.g. a principal covers the whole stage)
  stage_id uuid references public.school_stages(id),
  grade_id uuid references public.grades(id),
  class_id uuid references public.classes(id),
  subject_id uuid references public.subjects(id),
  effective_from date not null default current_date,
  effective_to date,
  check (effective_to is null or effective_to >= effective_from)
);
create index if not exists assignments_position_idx on public.employee_assignments(position_id);
create index if not exists assignments_employee_idx on public.employee_assignments(employee_id);
create index if not exists assignments_ctx_idx
  on public.employee_assignments(position_id, stage_id, grade_id, class_id, subject_id);

create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  class_id uuid references public.classes(id),
  full_name_ar text not null
);
create table if not exists public.parent_students (
  parent_id uuid not null references public.profiles(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  primary key (parent_id, student_id)
);

-- ---------- helpers (definer: read profiles without RLS recursion) ----------
create or replace function private.my_role() returns text
language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function private.my_school() returns uuid
language sql stable security definer set search_path = '' as $$
  select school_id from public.profiles where id = auth.uid()
$$;

create or replace function private.is_staff_reviewer() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select role in ('quality_manager','school_admin')
                   from public.profiles where id = auth.uid()), false)
$$;

grant execute on function private.my_role(), private.my_school(),
  private.is_staff_reviewer() to authenticated;

-- New auth users get a parent profile by default.
create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Always 'parent'. Staff roles are granted by an admin, never by sign-up metadata.
  insert into public.profiles (id, full_name, school_id)
  values (new.id,
          left(coalesce(nullif(new.raw_user_meta_data->>'full_name',''), new.email), 120),
          (select s.id from public.schools s
            where s.join_code is not null
              and s.join_code = upper(trim(new.raw_user_meta_data->>'school_code'))))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------- RLS ----------
alter table public.schools enable row level security;
alter table public.school_stages enable row level security;
alter table public.grades enable row level security;
alter table public.classes enable row level security;
alter table public.subjects enable row level security;
alter table public.departments enable row level security;
alter table public.positions enable row level security;
alter table public.profiles enable row level security;
alter table public.employees enable row level security;
alter table public.employee_private enable row level security;
alter table public.employee_assignments enable row level security;
alter table public.students enable row level security;
alter table public.parent_students enable row level security;

-- Reference data: readable by any signed-in member of the same school.
do $$
declare t text;
begin
  foreach t in array array['departments','positions','subjects','school_stages'] loop
    execute format('drop policy if exists %I on public.%I', t||'_read', t);
    execute format('create policy %I on public.%I for select to authenticated
                    using (school_id = private.my_school())', t||'_read', t);
  end loop;
end $$;

drop policy if exists schools_read on public.schools;
create policy schools_read on public.schools for select to authenticated
  using (id = private.my_school());

drop policy if exists grades_read on public.grades;
create policy grades_read on public.grades for select to authenticated
  using (exists (select 1 from public.school_stages s
                 where s.id = stage_id and s.school_id = private.my_school()));

drop policy if exists classes_read on public.classes;
create policy classes_read on public.classes for select to authenticated
  using (exists (select 1 from public.grades g join public.school_stages s on s.id = g.stage_id
                 where g.id = grade_id and s.school_id = private.my_school()));

-- Position configuration: school admins manage it.
drop policy if exists positions_admin_write on public.positions;
create policy positions_admin_write on public.positions for all to authenticated
  using (school_id = private.my_school() and private.my_role() = 'school_admin')
  with check (school_id = private.my_school() and private.my_role() = 'school_admin');

drop policy if exists profiles_self on public.profiles;
create policy profiles_self on public.profiles for select to authenticated
  using (id = auth.uid());
drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid() and role = private.my_role()
                                      and school_id is not distinct from private.my_school());

-- Employees and assignments: reviewers only. Parents reach names via search_employees().
drop policy if exists employees_reviewer_read on public.employees;
create policy employees_reviewer_read on public.employees for select to authenticated
  using (school_id = private.my_school() and private.is_staff_reviewer());

drop policy if exists assignments_reviewer_read on public.employee_assignments;
create policy assignments_reviewer_read on public.employee_assignments for select to authenticated
  using (private.is_staff_reviewer() and exists (
    select 1 from public.employees e where e.id = employee_id and e.school_id = private.my_school()));

drop policy if exists employee_private_admin on public.employee_private;
create policy employee_private_admin on public.employee_private for select to authenticated
  using (private.my_role() = 'school_admin' and exists (
    select 1 from public.employees e where e.id = employee_id and e.school_id = private.my_school()));

drop policy if exists students_parent_read on public.students;
create policy students_parent_read on public.students for select to authenticated
  using (exists (select 1 from public.parent_students ps
                 where ps.student_id = id and ps.parent_id = auth.uid()));

drop policy if exists parent_students_self on public.parent_students;
create policy parent_students_self on public.parent_students for select to authenticated
  using (parent_id = auth.uid());

grant select on all tables in schema public to authenticated;
grant insert, update, delete on public.positions to authenticated;
grant update on public.profiles to authenticated;
