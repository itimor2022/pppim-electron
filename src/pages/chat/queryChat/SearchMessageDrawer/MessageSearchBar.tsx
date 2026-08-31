import { SearchOutlined } from "@ant-design/icons";
import { useDebounceFn } from "ahooks";
import { Input } from "antd";
import { t } from "i18next";
import {
  forwardRef,
  ForwardRefRenderFunction,
  memo,
  useImperativeHandle,
  useState,
} from "react";

const MessageSearchBar: ForwardRefRenderFunction<
  { clear: () => void },
  { triggerSearch: (keyword: string) => void }
> = ({ triggerSearch }, ref) => {
  const [keyword, setKeyword] = useState("");
  const { run: debounceSearch, cancel: cancelSearch } = useDebounceFn(
    (value: string) => triggerSearch(value),
    { wait: 500 },
  );

  useImperativeHandle(
    ref,
    () => ({
      clear: () => {
        cancelSearch();
        setKeyword("");
      },
    }),
    [cancelSearch],
  );

  return (
    <div className="px-5.5">
      <Input
        value={keyword}
        allowClear
        spellCheck={false}
        onChange={(e) => {
          const value = e.target.value;
          setKeyword(value);
          debounceSearch(value);
        }}
        placeholder={t("placeholder.search")!}
        prefix={<SearchOutlined rev={undefined} />}
      />
    </div>
  );
};

export default memo(forwardRef(MessageSearchBar));
