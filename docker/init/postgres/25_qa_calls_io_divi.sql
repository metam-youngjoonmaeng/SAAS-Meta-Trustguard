-- 콜 채널구분(인바운드/아웃바운드) 보관.
--
-- 배경: qa_calls 에는 콜의 수신/발신 구분이 없었다. ICS 운영 DB(MariaDB mtm30)
--   tb_stt_master.IO_DIVI 가 'I'(인바운드/수신) / 'O'(아웃바운드/발신) 를 가진다.
--   → 평가 관리/리스트에서 채널 필터·표시를 위해 적재 시 함께 보관한다.
--
--   io_divi : 'I' | 'O' | NULL(비-ICS/시드 콜 등 채널 정보 없음)
-- 프론트는 I→인바운드, O→아웃바운드 로 매핑한다.
ALTER TABLE public.qa_calls ADD COLUMN IF NOT EXISTS io_divi text;

COMMENT ON COLUMN public.qa_calls.io_divi IS
    'ICS tb_stt_master.IO_DIVI(채널구분). I=인바운드(수신), O=아웃바운드(발신). NULL=정보 없음.';

CREATE INDEX IF NOT EXISTS idx_qa_calls_io_divi ON public.qa_calls (io_divi);
