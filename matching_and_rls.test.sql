-- Matching + RLS tests. Run with supabase/tests/run.sh (local Postgres 16).
\set ON_ERROR_STOP on

-- ---------- fixtures (as superuser) ----------
insert into public.schools (id, name_ar) values ('00000000-0000-0000-0000-000000000002','مدرسة أخرى') on conflict do nothing;
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-000000000001','parent1@test'),
  ('a0000000-0000-0000-0000-000000000002','parent2@test'),
  ('a0000000-0000-0000-0000-000000000003','qm@test'),
  ('a0000000-0000-0000-0000-000000000004','qm-other@test'),
  ('a0000000-0000-0000-0000-000000000005','admin@test')
on conflict do nothing;
update public.profiles set school_id = '00000000-0000-0000-0000-000000000001', role = 'parent'
  where id in ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002');
update public.profiles set school_id = '00000000-0000-0000-0000-000000000001', role = 'quality_manager'
  where id = 'a0000000-0000-0000-0000-000000000003';
update public.profiles set school_id = '00000000-0000-0000-0000-000000000002', role = 'quality_manager'
  where id = 'a0000000-0000-0000-0000-000000000004';
update public.profiles set school_id = '00000000-0000-0000-0000-000000000001', role = 'school_admin'
  where id = 'a0000000-0000-0000-0000-000000000005';

create temp table results (name text, ref text, status text);
grant all on results to authenticated;

-- ========== PARENT 1 ==========
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-000000000001', true);

do $$
declare r jsonb; n int; err text;
begin
  -- UNIQUE: one principal for the whole school
  r := public.submit_evaluation('{"target_type":"position","stage_id":"10000000-0000-0000-0000-000000000002",
        "position_id":"60000000-0000-0000-0000-000000000001","overall_satisfaction":5,
        "scores":{"professionalism":5,"decision_fairness":4}}');
  assert r->>'status' = 'matched', 'principal should be matched, got ' || r::text;
  insert into results values ('unique_principal', r->>'reference_no', r->>'status');

  -- AMBIGUOUS then resolved: vice principal differs by stage
  r := public.preview_match('{"position_id":"60000000-0000-0000-0000-000000000002"}');
  assert r->>'status' = 'ambiguous', 'vice principal without stage should be ambiguous';
  assert r->'needs' = '["stage"]'::jsonb, 'should ask for stage, got ' || (r->'needs')::text;
  assert not (r ? 'employee_id') and not (r ? 'candidates'), 'preview must not expose ids';
  r := public.preview_match('{"position_id":"60000000-0000-0000-0000-000000000002","stage_id":"10000000-0000-0000-0000-000000000001"}');
  assert r->>'status' = 'matched', 'vice principal with stage should match';

  -- AMBIGUOUS by grade: two primary supervisors
  r := public.preview_match('{"position_id":"60000000-0000-0000-0000-000000000004","stage_id":"10000000-0000-0000-0000-000000000001"}');
  assert r->>'status' = 'ambiguous' and r->'needs' = '["grade"]'::jsonb, 'supervisor should need grade, got ' || r::text;

  -- Teacher requires subject + class
  begin
    perform public.submit_evaluation('{"target_type":"position","position_id":"60000000-0000-0000-0000-000000000005",
          "subject_id":"40000000-0000-0000-0000-000000000001","overall_satisfaction":4}');
    assert false, 'teacher without class must fail';
  exception when others then
    get stacked diagnostics err = message_text;
    assert err = 'subject_and_class_required', 'unexpected error: ' || err;
  end;

  -- AMBIGUOUS: math grade 1 without class -> needs class
  r := public.preview_match('{"position_id":"60000000-0000-0000-0000-000000000005","stage_id":"10000000-0000-0000-0000-000000000001",
        "grade_id":"20000000-0000-0000-0000-000000000001","subject_id":"40000000-0000-0000-0000-000000000001"}');
  assert r->>'status' = 'ambiguous' and r->'needs' = '["class"]'::jsonb, 'math g1 should need class, got ' || r::text;

  -- UNIQUE teacher once class is known
  r := public.submit_evaluation('{"target_type":"position","stage_id":"10000000-0000-0000-0000-000000000001",
        "position_id":"60000000-0000-0000-0000-000000000005","grade_id":"20000000-0000-0000-0000-000000000001",
        "class_id":"30000000-0000-0000-0000-000000000002","subject_id":"40000000-0000-0000-0000-000000000001",
        "overall_satisfaction":4,"scores":{"explanation_clarity":4},"comments":"شرح واضح"}');
  assert r->>'status' = 'matched', 'math g1 class ب should match';
  insert into results values ('unique_teacher', r->>'reference_no', r->>'status');

  -- AMBIGUOUS even with full context: two teachers share English 3أ
  r := public.submit_evaluation('{"target_type":"position","stage_id":"10000000-0000-0000-0000-000000000001",
        "position_id":"60000000-0000-0000-0000-000000000005","grade_id":"20000000-0000-0000-0000-000000000003",
        "class_id":"30000000-0000-0000-0000-000000000003","subject_id":"40000000-0000-0000-0000-000000000003",
        "overall_satisfaction":3}');
  assert r->>'status' = 'ambiguous', 'co-taught class should stay ambiguous';
  insert into results values ('ambiguous_coteach', r->>'reference_no', r->>'status');

  -- UNMATCHED: nobody teaches science in grade 1
  r := public.submit_evaluation('{"target_type":"position","stage_id":"10000000-0000-0000-0000-000000000001",
        "position_id":"60000000-0000-0000-0000-000000000005","grade_id":"20000000-0000-0000-0000-000000000001",
        "class_id":"30000000-0000-0000-0000-000000000001","subject_id":"40000000-0000-0000-0000-000000000002",
        "overall_satisfaction":2,"comments":"لا يوجد تواصل"}');
  assert r->>'status' = 'unmatched', 'science g1 should be unmatched';
  insert into results values ('unmatched_science', r->>'reference_no', r->>'status');

  -- UNMATCHED: counselor's assignment ended -> today nobody holds it
  r := public.submit_evaluation('{"target_type":"position","position_id":"60000000-0000-0000-0000-000000000003","overall_satisfaction":3}');
  assert r->>'status' = 'unmatched', 'expired counselor should be unmatched';

  -- NEGATIVE + unique: must NOT be linked automatically
  r := public.submit_evaluation('{"target_type":"position","position_id":"60000000-0000-0000-0000-000000000001",
        "overall_satisfaction":1,"comments":"تأخر الرد على الشكوى"}');
  assert r->>'status' = 'pending_review', 'negative unique should be pending_review, got ' || r::text;
  insert into results values ('negative_unique', r->>'reference_no', r->>'status');

  -- Department-level
  r := public.submit_evaluation('{"target_type":"department","department_id":"50000000-0000-0000-0000-000000000007","overall_satisfaction":2}');
  assert r->>'status' is null, 'department evaluations carry no matching status';

  -- By name, positive -> matched by parent selection
  r := public.submit_evaluation('{"target_type":"employee","employee_id":"70000000-0000-0000-0000-000000000009","overall_satisfaction":5}');
  assert r->>'status' = 'matched';

  -- Name search returns names + positions only
  select count(*) into n from public.search_employees('الشمري');
  assert n = 1, 'name search should find one employee';
  select count(*) into n from public.search_employees('%%');
  assert n = 0, 'wildcards must not enumerate staff';

  -- Anonymous: stored without parent link
  r := public.submit_evaluation('{"target_type":"position","position_id":"60000000-0000-0000-0000-000000000006","overall_satisfaction":2,"anonymous":true}');
  insert into results values ('anonymous', r->>'reference_no', r->>'status');
  begin
    perform public.submit_evaluation('{"target_type":"department","department_id":"50000000-0000-0000-0000-000000000007",
            "overall_satisfaction":2,"anonymous":true,"follow_up":true,"contact_phone":"050"}');
    assert false, 'anonymous + follow-up must fail';
  exception when others then
    get stacked diagnostics err = message_text;
    assert err = 'follow_up_requires_identity', 'unexpected: ' || err;
  end;
  begin
    perform public.submit_evaluation('{"target_type":"department","department_id":"50000000-0000-0000-0000-000000000007",
            "overall_satisfaction":2,"follow_up":true}');
    assert false, 'follow-up without contact must fail';
  exception when others then
    get stacked diagnostics err = message_text;
    assert err = 'follow_up_requires_contact', 'unexpected: ' || err;
  end;

  -- Criterion that does not apply to the position is rejected
  begin
    perform public.submit_evaluation('{"target_type":"position","position_id":"60000000-0000-0000-0000-000000000001",
            "overall_satisfaction":4,"scores":{"safety":4}}');
    assert false, 'safety criterion does not apply to principal';
  exception when others then
    get stacked diagnostics err = message_text;
    assert err like 'invalid_criterion%', 'unexpected: ' || err;
  end;

  -- Cross-school context is rejected
  begin
    perform public.submit_evaluation('{"target_type":"position","position_id":"60000000-0000-0000-0000-000000000099","overall_satisfaction":4}');
    assert false, 'unknown position must fail';
  exception when others then
    get stacked diagnostics err = message_text;
    assert err = 'invalid_position', 'unexpected: ' || err;
  end;

  -- RLS: parent sees own identified evaluations only, never employees or confidential data
  select count(*) into n from public.evaluations;
  assert n = 8, 'parent1 should see 8 identified evaluations, saw ' || n;
  select count(*) into n from public.evaluations where anonymous_submission;
  assert n = 0, 'anonymous evaluation must not be visible to its sender';
  select count(*) into n from public.employees;
  assert n = 0, 'parent must not read employees table';
  select count(*) into n from public.employee_private;
  assert n = 0, 'parent must not read confidential employee data';
  select count(*) into n from public.evaluation_audit_log;
  assert n = 0, 'parent must not read audit log';

  begin
    insert into public.evaluations (school_id, overall_satisfaction) values ('00000000-0000-0000-0000-000000000001', 5);
    assert false, 'direct insert must be denied';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.review_mark_reviewed((select id from public.evaluations limit 1), 'x');
    assert false, 'parent must not review';
  exception when others then
    get stacked diagnostics err = message_text;
    assert err = 'not_authorized', 'unexpected: ' || err;
  end;
end $$;
commit;

-- ========== PARENT 2 cannot see parent 1 ==========
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-000000000002', true);
do $$ declare n int; begin
  select count(*) into n from public.evaluations;
  assert n = 0, 'parent2 must not see parent1 evaluations';
end $$;
commit;

-- ========== QUALITY MANAGER ==========
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-000000000003', true);
do $$
declare n int; e public.evaluations; err text; st record;
begin
  select count(*) into n from public.evaluations;
  assert n = 9, 'QM sees all school evaluations incl. anonymous, saw ' || n;

  -- queue holds ambiguous, unmatched, pending_review
  select count(*) into n from public.v_review_queue;
  assert n = 5, 'queue should hold 5 (ambiguous, 2 unmatched, pending, anonymous-unmatched), saw ' || n;

  -- performance view excludes unverified
  select count(*) into n from public.v_employee_performance where employee_id = '70000000-0000-0000-0000-000000000001';
  assert n = 1;
  select total into n from public.v_employee_performance where employee_id = '70000000-0000-0000-0000-000000000001';
  assert n = 1, 'principal: only the verified positive evaluation counts, got ' || n;

  -- confirm the pending negative principal evaluation
  select ev.* into e from public.evaluations ev join results r on r.ref = ev.reference_no where r.name = 'negative_unique';
  assert e.matched_employee_id is null and e.suggested_employee_ids = array['70000000-0000-0000-0000-000000000001'::uuid];
  perform public.review_set_employee(e.id, '70000000-0000-0000-0000-000000000001', 'تم التحقق مع وليّ الأمر');
  select * into e from public.evaluations where id = e.id;
  assert e.employee_matching_status = 'manually_verified' and e.matched_employee_id is not null;
  select total into n from public.v_employee_performance where employee_id = '70000000-0000-0000-0000-000000000001';
  assert n = 2, 'verified negative now counts';

  -- correct a match -> audit says corrected
  perform public.review_set_employee(e.id, '70000000-0000-0000-0000-000000000002', 'تصحيح');
  select count(*) into n from public.evaluation_audit_log where evaluation_id = e.id and action = 'match_corrected';
  assert n = 1, 'correction must be audited';

  -- ambiguous co-teach: request clarification from identified parent
  select ev.* into e from public.evaluations ev join results r on r.ref = ev.reference_no where r.name = 'ambiguous_coteach';
  assert cardinality(e.suggested_employee_ids) = 2, 'two candidates suggested';
  perform public.review_request_clarification(e.id, 'هل يمكنك تحديد اسم المعلم أو وقت الحصة؟');
  select review_state into st from public.evaluations where id = e.id;
  assert st.review_state = 'clarification_requested';

  -- anonymous cannot be contacted
  select ev.* into e from public.evaluations ev join results r on r.ref = ev.reference_no where r.name = 'anonymous';
  begin
    perform public.review_request_clarification(e.id, 'سؤال');
    assert false;
  exception when others then
    get stacked diagnostics err = message_text;
    assert err = 'anonymous_cannot_be_contacted', 'unexpected: ' || err;
  end;
  perform public.review_keep_department(e.id, 'لا يمكن التحديد');
  select * into e from public.evaluations where id = e.id;
  assert e.review_outcome = 'department_level' and e.matched_employee_id is null;

  -- unmatched science: mark reviewed
  select ev.* into e from public.evaluations ev join results r on r.ref = ev.reference_no where r.name = 'unmatched_science';
  perform public.review_mark_reviewed(e.id, null);

  -- AI suggestion saved without linking anyone
  perform public.review_save_ai(e.id, '{"category":"communication","explanation":"test"}');
  select * into e from public.evaluations where id = e.id;
  assert e.matched_employee_id is null and e.ai_classification->>'category' = 'communication';

  -- audit log is append-only for reviewers
  begin
    delete from public.evaluation_audit_log;
    assert false, 'audit delete must be denied';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.evaluations set matched_employee_id = null;
    assert false, 'direct update must be denied';
  exception when insufficient_privilege then null;
  end;

  -- QM reads employees but not confidential data
  select count(*) into n from public.employees;
  assert n = 11;
  select count(*) into n from public.employee_private;
  assert n = 0, 'QM must not read confidential employee data';
end $$;
commit;

-- ========== PARENT 1 answers the clarification ==========
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-000000000001', true);
do $$ declare e public.evaluations; n int; begin
  select * into e from public.evaluations where review_state = 'clarification_requested';
  assert e.id is not null, 'parent sees the clarification request';
  select count(*) into n from public.evaluation_messages where evaluation_id = e.id;
  assert n = 1, 'parent reads the reviewer question';
  perform public.parent_reply(e.id, 'المعلم الذي يدرّس الحصة الأولى');
  select * into e from public.evaluations where id = e.id;
  assert e.review_state = 'open';
end $$;
commit;

-- ========== QM from another school sees nothing ==========
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-000000000004', true);
do $$ declare n int; err text; begin
  select count(*) into n from public.evaluations;
  assert n = 0, 'other-school QM must see nothing';
  select count(*) into n from public.employees;
  assert n = 0;
end $$;
commit;

-- ========== school admin reads confidential data ==========
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-000000000005', true);
do $$ declare n int; begin
  select count(*) into n from public.employee_private;
  assert n = 1, 'admin reads confidential data';
end $$;
commit;

-- ========== anon role gets nothing ==========
begin;
set local role anon;
do $$ begin
  begin
    perform public.submit_evaluation('{}');
    assert false, 'anon must not execute';
  exception when insufficient_privilege then null;
  end;
end $$;
commit;

-- ========== incident date drives matching (as superuser fixture) ==========
insert into public.employee_assignments (employee_id, position_id, effective_from, effective_to)
values ('70000000-0000-0000-0000-000000000008','60000000-0000-0000-0000-000000000008', current_date - 200, current_date - 30);
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-000000000002', true);
do $$ declare r jsonb; begin
  r := public.preview_match(jsonb_build_object('position_id','60000000-0000-0000-0000-000000000008','incident_date', current_date - 60));
  assert r->>'status' = 'matched', 'transport supervisor was assigned on the incident date';
  r := public.preview_match(jsonb_build_object('position_id','60000000-0000-0000-0000-000000000008','incident_date', current_date));
  assert r->>'status' = 'unmatched', 'assignment ended before today';
end $$;
commit;

select 'ALL TESTS PASSED' as result;
