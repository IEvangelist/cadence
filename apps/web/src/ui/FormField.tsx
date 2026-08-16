import { type AriaAttributes, type ReactNode, useId } from 'react'

interface FieldControlProps {
  'aria-describedby'?: string
  'aria-invalid'?: AriaAttributes['aria-invalid']
}

interface FormFieldProps {
  label: string
  children: ReactNode | ((controlProps: FieldControlProps) => ReactNode)
  htmlFor?: string
  hint?: ReactNode
  error?: ReactNode
}

export function FormField({
  label,
  children,
  htmlFor,
  hint,
  error,
}: FormFieldProps) {
  const hintId = useId()
  const errorId = useId()
  const describedBy = [hint ? hintId : null, error ? errorId : null]
    .filter(Boolean)
    .join(' ')
  const controlProps: FieldControlProps = {
    'aria-describedby': describedBy || undefined,
    'aria-invalid': error ? true : undefined,
  }

  return (
    <div className="form-field">
      <label className="form-field__label" htmlFor={htmlFor}>
        {label}
      </label>
      {typeof children === 'function' ? children(controlProps) : children}
      {hint ? (
        <div className="form-field__hint" id={hintId}>
          {hint}
        </div>
      ) : null}
      {error ? (
        <div className="form-field__error" id={errorId} role="alert">
          {error}
        </div>
      ) : null}
    </div>
  )
}
