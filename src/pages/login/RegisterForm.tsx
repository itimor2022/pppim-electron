import { LeftOutlined } from "@ant-design/icons";
import { App, Button, Form, Input, Select, Space } from "antd";
import { t } from "i18next";
import md5 from "md5";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { BusinessAllowType, useRegister } from "@/api/login";
import { useUserStore } from "@/store";
import { setAreaCode, setEmail, setIMProfile, setPhoneNumber } from "@/utils/storage";

import { areaCode } from "./areaCode";
import type { FormType } from "./index";

type RegisterFormProps = {
  loginMethod: "phone" | "email";
  setFormType: (type: FormType) => void;
};

type FormFields = {
  email?: string;
  phoneNumber?: string;
  areaCode: string;
  verifyCode: string;
  invitationCode: string;
  nickname: string;
  password: string;
  password2: string;
};

const RegisterForm = ({ loginMethod, setFormType }: RegisterFormProps) => {
  const { message } = App.useApp();
  const [form] = Form.useForm<FormFields>();
  const navigate = useNavigate();
  const { mutate: register } = useRegister();

  const needInvitationCode = useUserStore(
    (state) =>
      Number(state.appConfig.needInvitationCodeRegister) === BusinessAllowType.Allow,
  );

  // 0login 1resetPassword 2register
  const [registerForm, setRegisterForm] = useState(0);

  const isEmail = loginMethod === "email";

  const onFinish = (fields: FormFields) => {
    if (registerForm === 0) {
      const pattern = /^1\d{10}$/;
      if (fields.phoneNumber && !pattern.test(fields.phoneNumber)) {
        return message.error(t("toast.inputCorrectPhoneNumber"));
      }
      setRegisterForm(2);
      return;
    }

    const verifyCode = "666666";

    if (registerForm === 2) {
      setAreaCode(fields.areaCode);
      if (fields.phoneNumber) {
        setPhoneNumber(fields.phoneNumber);
      }
      if (fields.email) {
        setEmail(fields.email);
      }

      register(
        {
          invitationCode: fields.invitationCode,
          verifyCode,
          autoLogin: true,
          user: {
            nickname: fields.nickname,
            faceURL: "",
            areaCode: fields.areaCode,
            phoneNumber: fields.phoneNumber,
            password: md5(fields.password),
            email: fields.email,
          },
        },
        {
          onSuccess(res) {
            message.success(t("toast.registerSuccess"));
            const { chatToken, imToken, userID } = res.data;
            setIMProfile({ chatToken, imToken, userID });
            navigate("/chat");
          },
        },
      );
    }
  };

  const back = () => {
    setFormType(0);
    form.resetFields();
  };

  return (
    <div className="flex flex-col justify-between">
      <div className="cursor-pointer text-sm text-gray-400" onClick={back}>
        <LeftOutlined rev={undefined} />
        <span className="ml-1">{t("placeholder.getBack")}</span>
      </div>
      <div className="mt-4 text-2xl font-medium">
        {registerForm === 0 && <span>{t("placeholder.register")}</span>}
        {registerForm === 2 && <span>{t("placeholder.setInfo")}</span>}
      </div>
      <Form
        form={form}
        layout="vertical"
        labelCol={{ prefixCls: "custom-form-item" }}
        onFinish={onFinish}
        autoComplete="off"
        className="mt-4"
        initialValues={{ areaCode: "+86" }}
      >
        {loginMethod === "phone" ? (
          <Form.Item label={t("placeholder.phoneNumber")} hidden={registerForm !== 0}>
            <Space.Compact className="w-full">
              <Form.Item name="areaCode" noStyle>
                <Select options={areaCode} className="!w-28" />
              </Form.Item>
              <Form.Item name="phoneNumber" noStyle>
                <Input allowClear placeholder={t("toast.inputPhoneNumber")} />
              </Form.Item>
            </Space.Compact>
          </Form.Item>
        ) : (
          <Form.Item
            label={t("placeholder.email")}
            name="email"
            rules={[
              { required: true, message: t("toast.inputEmail") },
              { type: "email", message: t("toast.inputCorrectEmail") },
            ]}
            hidden={registerForm !== 0}
          >
            <Input allowClear placeholder={t("toast.inputEmail")} />
          </Form.Item>
        )}

        <Form.Item
          className="mb-24"
          label={t("placeholder.invitationCode")}
          name="invitationCode"
          rules={
            needInvitationCode
              ? [
                  {
                    required: true,
                    whitespace: true,
                    message: t("toast.inputInvitationCode"),
                  },
                ]
              : undefined
          }
          hidden={registerForm !== 0}
        >
          <Input
            allowClear
            spellCheck={false}
            placeholder={`${t("toast.inputInvitationCode")}${
              !needInvitationCode ? t("placeholder.optional") : ""
            }`}
            className="w-full"
          />
        </Form.Item>

        {registerForm === 2 && (
          <>
            <Form.Item
              label={t("placeholder.nickName")}
              name="nickname"
              hidden={registerForm !== 2}
              rules={[
                {
                  required: true,
                },
              ]}
            >
              <Input
                allowClear
                spellCheck={false}
                placeholder={t("toast.inputNickName")}
              />
            </Form.Item>

            <Form.Item
              label={t("placeholder.password")}
              name="password"
              rules={[
                {
                  required: true,
                  pattern: /^(?=.*[0-9])(?=.*[a-zA-Z]).{6,20}$/,
                  message: t("toast.passwordRules"),
                },
              ]}
            >
              <Input.Password allowClear placeholder={t("toast.inputPassword")} />
            </Form.Item>

            <Form.Item
              label={t("placeholder.confirmPassword")}
              name="password2"
              dependencies={["password"]}
              rules={[
                {
                  required: true,
                  message: t("toast.reconfirmPassword"),
                },
                ({ getFieldValue }) => ({
                  validator(_, value) {
                    if (!value || getFieldValue("password") === value) {
                      return Promise.resolve();
                    }
                    return Promise.reject(new Error(t("toast.passwordsDifferent")));
                  },
                }),
              ]}
              className="mb-8"
            >
              <Input.Password allowClear placeholder={t("toast.reconfirmPassword")} />
            </Form.Item>
          </>
        )}

        <Form.Item>
          <Button type="primary" htmlType="submit" block>
            {registerForm === 2 ? t("confirm") : t("placeholder.nextStep")}
          </Button>
        </Form.Item>
      </Form>
    </div>
  );
};

export default RegisterForm;
